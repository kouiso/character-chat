# アバター画像生成ルール（2026-07-13 全面改定）

## 唯一の正規手段

キャラ画像（プロフィール・サブ画像・チャット内生成すべて）は **Novita API 直・モデル固定** で生成する。

- モデル: `waiNSFWIllustrious_v90_1187991.safetensors` **以外使わない**
- 旧手段 **codex `$imagegen`（OpenAI モデル）は廃止**（局長裁定 2026-07-13）。既存の imagegen 製アセット（旧プロフ・旧サブ）は資産として残すが、新規生成には使わない
- タッチの基準: **waiNSFW の自然な描き方**を活かす（OpenAI の水彩タッチへ無理やり寄せない）。そのかわり**キャラの同一性（顔・髪・瞳・アクセ・雰囲気）を既存プロフに極力似せる**
- 同一性の主手段: 既存プロフ画像を元絵にした **img2img**（忠実度 0.5 前後から調整）＋ image_meta.appearance のタグ

## 必須記録（gen_params — migration 0048）

生成した瞬間に `image_review.gen_params` / 採用時は `character_sub_image.gen_params` に JSON で記録する（後付けバックフィル禁止）:
`{model, provider, strength, steps, sampler, guidance, width, height, stages, base_image}`

## 品質ゲート

1. 生成者（Claude）の一次フィルタ: 拡大クロップ4領域の実目視
2. **独立審査パネル**（新品コンテキストの agent・プロフ並置比較・90点未満は局長に出さない）
3. 局長採点 = 唯一の採用ゲート

## 禁止事項

| 手段 | 理由 |
|------|------|
| codex `$imagegen` / OpenAI 画像モデル | 廃止（局長裁定 2026-07-13）。タッチが waiNSFW と混ざり統一を壊す |
| waiNSFW 以外の Novita モデル（darkSushi/meinahentai等） | モデル固定の局長裁定（2026-07-12） |
| Codex Cloud / bg-MCP 経由の画像生成 | 廃止済み |
| 生成前のコスト提示なしの大量生成 | 枚数と概算コストを提示してから |
