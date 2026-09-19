# quality audit — immersion gap (2026-05-17)

## Executive summary
現状の chat 品質は「興奮は作れるが、没入が途切れて頂点まで到達しづらい」状態で、主因は“過剰拘束された生成規則”と“誤検知ベースの差し戻し”の組み合わせにある。[コード解析] `functions/api/[[route]].ts` では phase ごとに大量の禁止語・必須ルール・即時エスカレーション命令が重層化し、自然な呼吸（間・揺れ・連続性）よりもチェックリスト準拠が優先されている。[コード解析] さらに `responseLength` の長文化と memory 注入の同時適用が毎ターンの情報密度を押し上げ、官能体験としての「一点集中」より説明的な冗長さに寄っている。[コード解析]

---

## Top 3 immersion blockers

### 1) ルール密度過多による“チェックリスト文体化”
- Impact: **high**
- PR size estimate: **L**
- Evidence:
  - [コード解析] `functions/api/[[route]].ts:2594-2662`（NSFW規則 + 禁止フレーズ + 感覚義務 + 3ターン語彙禁止 + Push/Pull などを同時要求）
  - [コード解析] `functions/api/[[route]].ts:2700-2745`（XML構造義務 + 感覚義務 + phase進行命令 + afterglow維持を重畳）
  - [コード解析] `functions/api/[[route]].ts:2749-2778`（conversation 側にも XML 厳格義務と phase escalation 命令を重ねる）

**Root cause**  
生成モデルに対して「何を書くべきか」より「何を絶対に外すな」が過多で、しかも同一ターン内に複数の最適化目標（具体性・非反復・感覚ローテ・phase順守・構造XML厳守）を同時達成させているため、出力が“生っぽい欲望の流れ”ではなく“要件充足テキスト”に寄る。結果としてユーザー体感は「エロい情報は多いが、体験として波に乗れない」。

**Proposed fix**  
Prompt を 2 層化する。Tier A（絶対遵守）は安全境界と人格維持のみ、Tier B（品質向上）はソフト目標として 1〜2 項目/ターンに縮約する。具体的には `PLATFORM_BASE_SCENE` から「直前3ターン語彙禁止」「毎ターン2感覚義務」「禁止フレーズ長表」などを削減し、代わりに「前ターンとの差分を1つ作る」程度の軽量指示へ置換。加えて phase 別に“許容揺らぎ”を定義し、erotic/climax でも 1 ターン分の呼吸（間・ためらい・余韻）を許可して単調な加速を避ける。

**Pre-mortem (backfire + mitigation)**
1. ルール削減で低品質テンプレ表現が再増殖する。→ Mitigation: 禁止語ブラックリストではなく、サーバー側 quality judge の「重複度」スコア閾値で検知。  
2. モデルごとの差で出力が暴れ、露骨さが過剰化する。→ Mitigation: モデル別の軽量 suffix ガイドを維持し、出力分布を A/B 監視。  
3. 安全境界まで弱まり、意図しない文脈飛躍が増える。→ Mitigation: Tier A に phase ceiling と user-action non-assumption だけは残す。  
4. XML 崩れが増える。→ Mitigation: 失敗時のみ構造再生成リトライ（内容指示は増やさない）。

---

### 2) 誤検知しやすい persona/refusal 判定で“熱のある応答”が差し戻される
- Impact: **high**
- PR size estimate: **M**
- Evidence:
  - [コード解析] `functions/api/lib/refusal-detect.ts:1-8`（短い正規表現で refusal/erotic cue を判定）
  - [コード解析] `functions/api/lib/persona-break-detect.ts:1-11`（consent/apology の広いパターン）
  - [コード解析] `functions/api/[[route]].ts:5974-6032`（検知ヒットで assistant 応答を user 指示付きで再生成）

**Root cause**  
現行検知は文脈非依存のキーワード一致寄りで、自然な台詞中の「間」「確認」「弱い躊躇」まで breakage と判定する可能性が高い。さらに retry では “直前応答は逸脱” というメタ指示を user ロールで追加するため、モデルは没入より修正タスクを優先しがちになり、結果として熱量が途切れる。

**Proposed fix**  
検知器を「単語一致」から「phase 条件付きスコアリング」に更新する。例: erotic/climax では refusal 語単発は許容し、(a)拒否語の連続、(b)行為停止命令、(c)露骨な安全ガイド語、の複合でのみ retry 発火。retry 形式もメタ修正文ではなく、システム側 hidden hint に退避し、ユーザー会話ログへ注入しない。これで“修正している感じ”を減らし、体験連続性を守る。

**Pre-mortem (backfire + mitigation)**
1. 検知を厳しくしすぎて本当に壊れた応答を見逃す。→ Mitigation: 重大リーク（謝罪定型・安全文定型）は hard trigger を維持。  
2. retry 減少で品質回復率が落ちる。→ Mitigation: one-shot retry は維持しつつ発火条件だけ精緻化。  
3. スコアリング実装で運用コスト増。→ Mitigation: 先に既存 regex に phase gate を追加する段階導入。  
4. hidden hint 化でデバッグ困難化。→ Mitigation: telemetry に trigger reason を構造化記録。

---

### 3) 長文化プリセット + 記憶注入で“濃いが抜けない”情報過密
- Impact: **med**
- PR size estimate: **M**
- Evidence:
  - [コード解析] `functions/api/[[route]].ts:5927-5946`（long=1800 / very_long=3000 tokens + 長文化ヒント追記）
  - [コード解析] `functions/api/[[route]].ts:5911-5924`（memory note 選抜→system注入→augment）
  - [コード解析] `src/component/chat/chat-view.tsx:114-117,136-144`（一定間隔で memory 抽出、最大50ターンを素材化）
  - [コード解析] `src/component/chat/chat-view.tsx:2302,2468,2579,2725`（responseLength が複数送信経路で継続適用）

**Root cause**  
“長く濃く”を安定化するための token 予算増加とメモリ活用が、没入の要である「焦点化（いまこの触覚・いまこの息）」を阻害し、結果として説明・要約・状況整理が混ざりやすくなる。ユーザー体感では「情報は多いが、身体の一点に刺さらない」ため、興奮はするがピークに到達しない。

**Proposed fix**  
phase 連動の長さ制御に変更する。erotic/climax は“文字数上限より密度上限”へ寄せ、`very_long` でも 2 段構成（前半: 行為の焦点、後半: 反応の余韻）に制約。memory は erotic/climax 中は最大 2 件まで（関係性 core のみ）に制限し、設定説明系メモリは afterglow 以降へ遅延。UI 側 `responseLength` は同値でも、phase に応じたサーバー正規化（例: climax で medium 相当にクリップ）を行う。

**Pre-mortem (backfire + mitigation)**
1. 短文化しすぎて満足度が落ちる。→ Mitigation: 文字数ではなく“感覚密度”KPI（具体名詞率・動作連鎖）で評価。  
2. memory 制限でキャラ一貫性が崩れる。→ Mitigation: 関係性・呼称・禁則のみを常時保持する core memory 別枠化。  
3. ユーザーが very_long を選んだ意図と衝突。→ Mitigation: setting に「ピーク優先最適化」トグルを追加し opt-out 提供。  
4. phase clip が不透明で“設定が効かない”不信感。→ Mitigation: UI ヘルプに phase-aware length policy を明示。

---

## Suggested PR breakdown (if implementing all 3)
1. **PR-A (S〜M): detector precision**  
   `refusal-detect.ts` / `persona-break-detect.ts` / retry 発火条件（`[[route]].ts`）を phase-gated 化。まず誤検知率を下げ、体験中断を減らす。  
2. **PR-B (M): length+memory phase normalization**  
   `responseLength` preset と memory 注入上限を phase-aware に変更。erotic/climax の情報過密を緩和。  
3. **PR-C (L): prompt architecture slimming**  
   `buildPlatformPrefix` の重複・過拘束ルールを再編（Tier A/B 分離）。A/B で immersion 指標比較。

---

## Open questions for human judgment
1. 「抜ける品質」を最優先する場合、倫理的に許容する“躊躇/同意確認”の最小頻度をどこに置くか（完全排除か、演技として残すか）。[コード解析]  
2. climax の理想文体は「短い断片連打」か「中尺で波を描く」か。ユーザー層ごとに分岐すべきか。[コード解析]  
3. very_long を好むヘビーユーザーと、ピーク到達重視ユーザーを同一設定で扱うべきか（別プリセット導入判断）。[コード解析]  
4. retry を不可視化した場合の運用透明性（サポート調査性）をどこまで維持するか。[コード解析]

---

## Scope & duplication check
- 本レポートは既存 `.work/qa/ux-audit-2026-05-16.md` の UI 中心論点（導線・ヘッダ overflow 等）とは重複せず、chat 没入品質の生成ロジックに限定した。[コード解析]
- 調査対象は指定スコープ（`functions/api/[[route]].ts`, detection libs, `prompt/instructions/`, `.work/qa/`, `chat-view.tsx`）のみ使用した。[コード解析]
