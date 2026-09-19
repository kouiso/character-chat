# チャット内画像生成の経路マップ（2026-07-26 時点 / origin/main 5195247c）

対象は「チャット中にキャラの画像を吐き出す」経路のみ。プロフィール画像はこのAPIでは
作らず、`POST /api/avatar/upload` でアップロードした正典画像を使う。マンガ経路
(`initNovitaComicTask`) は別レーンで修正中のため対象外。

## 全体像

```
クライアント
   │  POST /api/image  (imageSchema)
   ▼
functions/api/[[route]].ts:8580  .post("/image", ...)
   │
   ├─ 1. 入力ガード
   │     checkContentFilter(prompt / characterDescription)      → 403
   │     enforceRateLimit(..., "image")                          → 429
   │     validateImageGenerationOwnership(db, userId, input)      → 404
   │
   ├─ 2. 身元の解決  ← ここが「プロフと同一人物か」の全て
   │     SELECT character.visual_prompt, image_meta, seed  (userId 条件つき)
   │     resolveCharacterImageIdentity()   functions/api/lib/image-identity-context.ts:32
   │        ├ buildImageMetaAnchors()      functions/api/lib/image-meta-anchor.ts:13
   │        │    positive = appearance + artStyle + outfit を "," 連結
   │        │    negative = image_meta.negativePrompt
   │        ├ description = image_meta由来 || requestedDescription || visual_prompt
   │        └ seed        = character.seed が有効ならそれ、無ければ
   │                        deriveCharacterImageSeed(characterId)  ← FNV-1a の決定的ハッシュ
   │
   ├─ 3. シーン層の解決
   │     detectExplicitContent(prompt)                → explicit タグ
   │     resolveSceneBackground(scene_state → character_default → keyword → none)
   │     pickNonRepeatingTag(posePool[phase])         → ポーズ多様性
   │     PHASE_GUARDRAILS[phase]                      → negativeExtra / positiveHint
   │     phaseExpressionTags[phase] / phaseForbiddenExpressions[phase]
   │
   ├─ 4. LoRA ゲート  (erotic / climax のみ)
   │     SELECT character.lora_model, lora_weight, lora_trigger_prompt
   │     loraModel あり かつ weight>0 → loraGate 成立
   │        · anchor ブロックを trigger prompt で全置換
   │        · negative を LORA_PINNED_RECIPE の 11 タグへ全置換
   │        · txt2img 固定（参照画像を読まない）
   │     ※ 本番 221 体中 LoRA 登録は 1 体のみ。実質 220 体は非LoRA経路。
   │
   ├─ 5. アイデンティティタグの合成
   │     image_meta あり → profileImageAnchors をそのまま採用（再解釈しない）
   │     image_meta 無し → loadVisualMeta(character_visual) → buildIdentityPrompt()
   │                       + extractVisualAnchors(description) の正規表現抽出
   │     ★ どちらも空なら 422 character_identity_missing で停止（本PRで追加）
   │
   ├─ 6. プロンプト組み立て
   │     translatePromptToImageTags()  日本語シーン文 → 英語タグ（LLM・8秒でタイムアウト）
   │     positive = masterpiece, best quality, anatomically_correct_hands, five_fingers,
   │                subjectTags, (visualAnchorBlock:weight), povTags,
   │                phaseExpression, phasePositiveHint, scenePrefix, background,
   │                explicitTags, translatedTags
   │                → dedupePromptTags() → climax/afterglow は stripFloatingCumTags()
   │     negative = input.negative_prompt + S_TIER_NEGATIVE_INJECTION
   │                + NOVITA_HAIR_COLOR_NEGATIVE_TAGS + identityNegative
   │                + phaseGuardrail.negativeExtra + forbiddenExpression
   │                + 末尾の固定ブロック（約35タグ）
   │                → dedupePromptTags()
   │
   ├─ 7. モデルとパラメータ
   │     model   = CHAT_IMAGE_MODEL_BY_PHASE[phase]   全 phase waiNSFWIllustrious_v90 に統一
   │     steps   = 32 固定 / sampler = phase別 / cfg = 7.0〜9.0
   │     seed    = 手順2で解決した決定的 seed
   │     img2img = getCharacterReferenceImageBase64()（非LoRA経路のみ）strength 0.45
   │
   ├─ 8. プロバイダ振り分け
   │     createImageGenRouter()   src/lib/image-gen/router.ts:38
   │        loras あり  → Runware 固定（Novita は自作 LoRA を構造的に弾く）
   │        loras なし  → Novita を試行 → fallbackEligible なら Runware へ退避
   │     RunwareImageGenProvider は RUNWARE_MODEL_MAP に無いモデルを 400 で拒否
   │        waiNSFWIllustrious_v90_1187991.safetensors → aiadultapp:waiillustrious@9
   │
   └─ 9. 後段
         writeImageTaskStartedAt()                      滞留タイムアウト用マーカー
         writeVlmLikenessGateContext()                  Novita かつ参照画像ありの時のみ
         GET /api/image/task/:taskId でポーリング
            └ applyVlmLikenessGate()  VLM が別人判定なら seed を変えて自動再生成（最大N回）
         POST /api/image/persist で R2 へ保存
```

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `functions/api/[[route]].ts:8580-9090` | `POST /image` 本体。プロンプト組み立てとパラメータ決定 |
| `functions/api/[[route]].ts:1074` | `CHAT_IMAGE_MODEL_BY_PHASE`（全phase wai固定） |
| `functions/api/lib/image-identity-context.ts` | `resolveCharacterImageIdentity` / 決定的seed導出 |
| `functions/api/lib/image-meta-anchor.ts` | `image_meta` → positive/negative アンカー |
| `functions/api/lib/identity-prompt-builder.ts` | `character_visual` → アンカー（image_meta 無い時の代替） |
| `functions/api/lib/image-prompt-anchors.ts` | 重み付け・dedupe・floating cum 除去 |
| `functions/api/lib/image-phase-guardrails.ts` | phase別 negative/positive ガードレール |
| `src/lib/image-gen/router.ts` | Novita / Runware 振り分けとフォールバック |
| `src/lib/image-gen/runware-provider.ts` | モデル別名マップ。未登録モデルは 400 |

## 身元の担い手（3系統・優先順）

1. **`character.image_meta`** — 承認済みの不変ベース。あれば再解釈せずそのまま使う。本番 120/221 体。
2. **`character_visual` テーブル** — 正規化済み VisualMeta。image_meta が無い時の代替。
3. **`character.visual_prompt` / リクエストの `characterDescription`** — 正規表現抽出。最後の砦。

本番D1では image_meta も character_visual も無い体が 66 体あるが、全体に
`visual_prompt` は入っており、3系統すべてが空の体は **0 体**。

## seed の実態

`character.seed` は 221 体すべて NULL。ただし `resolveCharacterImageIdentity` が
`deriveCharacterImageSeed(characterId)`（FNV-1a ハッシュ）で決定的に導出するため、
**同一キャラ・同一プロンプトなら seed は再現する**。「seed 未保存＝非決定的」ではない。

一方 `image_review` 側は 98 件中 67 件が seed NULL で、**審査済み画像を後から
同じ条件で再生成することはできない**。
