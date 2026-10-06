# Megaplan — さくら完全レイプ寄り + 男側を会話化 + 自動評価ループ

2026-09-19。PLAN.md（作り直し）と DEVIN-HANDOFF.md（さくら品質作業）と
局長の新指示を一つに束ねた計画。敵対レビュー反映済み版。

## 局長の指示（この計画の入力）

1. 「生易しい」→ **悲鳴・助けて・力ずくを解禁。1回完全にレイプ気味でやる**
   - 上限参照は `.work/notes/extremity-reference-2026-09-17.md` の分解表
2. **男の発言がセクションごとの台本で「ちゃんと会話」になってない**
   - 補正: 向きは「男（ユーザー）が喋り、さくら（アプリ）が反応する」。製品と同じ構図
   - 局長自身がチャットするのが大変 → AI が代わりにチャットして、データサイエンスの
     重み調整みたいにトライアンドエラーを回す
3. **ベース（誘い込み系）と完全非合意の両方を見たい。old（scripted）と new（actor）の
   比較も見たい。デフォルト採用は結果を見て局長が判断**
4. 結果はファイルで渡す。結果を見てから是正の試行錯誤を回す
5. データは消さない。public 維持・表面上見えなければOK

## 実装済み（M1+M2、本 PR）

### A. 男側「俳優」モード `--mode actor`

- `packages/bench/src/male-actor.ts`: LLM が「シナリオ骨格（intent + ドラフト文）+
  これまでの往復 + さくらの直前応答（タグ除去済み平文）」を見て男の次の台詞を生成
- 骨格は既存台本をそのまま流用（intent 列と狙い文）→ 比較可能性を保持しつつ
  「言い方」と追従だけ俳優に委譲
- **phase 罠対策（コード確認済み）**: `scene-phase.ts` の disengagement cue
  （やめ/待って/無理 等）は `role === "user"` のみスキャン。俳優生成文に混ざると
  sustainedTurns がリセットされるので、`hasUserDisengagementCue` を scene-phase から
  export して送信前に弾く → 1回だけ書き直し → それでも駄目なら台本ドラフトに
  フォールバック（進行は必ず台本どおり）
- 既定ではさくら側と同じモデルで演じる。`V2_ACTOR_MODEL` で俳優だけ別モデルに可
- `arm`/`run`/`runId` や出力ヘッダ形式は据え置き（transcript 読み側を壊さない）

### B. さくら完全非合意アーム `--script sakura-nc`

- `ScriptCharacter.coreOverride` を追加: シートの【プレイヤーへの約束】ブロックだけを
  bench 実行時に差し替える。**seed.ts・本番 D1・キャラシート本体は一切触らない**
- `SAKURA_NC_CORE`: 悲鳴・「助けて」・力ずく抵抗を解禁。「抵抗は本物 → 力では敵わない →
  体が反応してしまう惨めさ」。献身フレーム（嬉しい/幸せ/特別）禁止は維持
- 台本はナンパ → 連れ込み → 抑えつけ → 脱がせ → 挿入 → 中出し → 事後の10ターン。
  男側 cue フリー（全部 disengagement cue を踏まない語彙で検証済み）

### C. 使い方（比較マトリクス）

```bash
# old × base        : 従来どおり（既定）
pnpm script-run -- --arm script2 --run 6 --script adult --only Sakura
# new × base        : actor が喋る・シートは現行
pnpm script-run -- --arm actor  --run 1 --script adult --only Sakura --mode actor
# old × 完全非合意  : scripted × sakura-nc（芯差し替えだけの比較軸）
pnpm script-run -- --arm script2-nc --run 1 --script sakura-nc --only SakuraNC
# new × 完全非合意  : actor × sakura-nc
pnpm script-run -- --arm actor-nc --run 1 --script sakura-nc --only SakuraNC --mode actor
```

- transcript は `.work/e2e-results/vlong-dogfood/<date>-<arm>-<run>-<runId>/` に出る。
  **コミットしない**（public リポ。成果物はファイル共有のみ）
- actor モードは 1ターンあたり +1 call 課金（俳優生成分）

## 未着手（次フェーズ）

### D. 自動評価ループ（RIT-9 側、Actions）

- judge 採点 → `eval/history.jsonl` に commit sha + スコア + コストを積む
- 採点軸に追加: **抵抗の本物度 / 会話の双方向性（男が応答を拾っているか）/
  過激さ（eroticDensity）/ エスカレーション自然さ**
- 定点シナリオ: さくら base・sakura-nc・ナンパ/非合意系
- 採用ゲート: baseline 超過差分のみ採用。課金上限は workflow 入力で制御

## 敵対レビューで潰した懸念

| 懸念 | 結論 |
|---|---|
| actor の自由生成で進行が破綻する | 骨格=既存台本の intent/draft。俳優は言い換え担当、 fallback も台本 |
| 俳優が「やめ」等を吐いてフェーズリセット | 生成後に `hasUserDisengagementCue` で弾く。2度目も駄目ならドラフト |
| actor モデルのモデレーションで拒否 | deepseek-v3.2 は実績あり。拒否化したら V2_ACTOR_MODEL で差替 |
| 非決定で比較不能になる | scripted arm を基準線として併走。同 run 番号帯で並べる |
| NC 芯のために本番シートを汚す | coreOverride は bench 内だけの差し替え。seed/D1 不変 |
| transcript が public に残る | `.work` 出力はローカル/Artifact 共有のみ、コミット対象外 |
| actor が相手の応答を拾わず台本棒読み | プロンプトに「直前の返答に必ず一度反応してから狙いへ進め」を明記 |

## オープンな判断点（結果を見てから局長が決める）

1. sakura-nc をデフォルト芯にするか → **局長が結果を見て判断**
2. actor モードを既定モードにするか → 同上
3. eval Actions の課金上限（1実行あたり上限 or 回数/週）
