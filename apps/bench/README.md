# apps/bench — 検証台

生成テキストの質だけを数字で測る台。UI は無い。React も無い。

既存の `src/` `functions/` には **1行も触っとらん**。pnpm workspace にも入れとらん
（ルートの lockfile を書き換えて既存の解決を壊すリスクを避けるため）。依存パッケージはゼロで、
Node 24 の組み込み（`node:sqlite` / `node:test` / 型ストリッピング）だけで動く。

## なんでこれを作ったか

7ヶ月アプリを直し続けても品質が上がらんかった。過去の全会話（334 発話 / 57 会話）を
機械分析して分かったことは2つある。

1. **モデルは書けとる。** 拒否・メタ発言は 8件 = 2.4%。最長 819 字のサンプルは
   体位・部位・液体・寝具まで具体的に描写できとった。検閲は主因ではない。
2. **台の故障も主因ではない。** 会話が「返事なし」で終わったのは 2/57 = 4%、
   「空返信」で終わったのは 4/57 = 7%。空返信 62 件のうち 58 件は会話の途中で、
   その後も会話は続いとる。台由来の死は症状の 11% しか説明せん。

残った説明は「75% の会話が2ターン以内で終わっとる」、つまり
**生成テキストそのものの質（長さ・筆力）**の側や。median 154 字の返事が
2ターン目に来たら、続ける気は起きひん。

過去のスコア（deepseek 94.8 / qwen 83.0 / euryale 65.8）と `evals/score-index.jsonl` は
採用根拠にならん。後者は n=94 で judgment が PASS 33 / unknown 61、
PASS 33 件の最高点は 80 点でリポジトリ自身の合格ライン 90 を超えたものは 0 件やった。

## 使い方

```bash
cd apps/bench

pnpm run baseline   # 既存バックアップに機械7軸を回して基準線を出す（API を叩かん＝課金ゼロ）
pnpm test           # 基準線が再現することを確かめる（測定器の測定器）

pnpm run turn       # P1: 会話を1ターン進める
pnpm run run -- --turns=20            # P2: N ターン自動で回す
pnpm run run -- --list=1              # 再生できる既存会話の一覧
pnpm run score                        # 記録済み run の機械7軸を並べる
pnpm run serve                        # POST /turn, POST /run, GET /score, POST|GET /feedback

pnpm run compare -- --turns=8 --conditions='[{"label":"a","responseLength":400}]'   # P4: 条件比較
pnpm run probe -- --suspect=all                                                     # P3: 死因の再現
pnpm run feedback -- --run=<runId> --came=1 --continue=1                            # P5: 👍の口
```

**Node 24 が要る**（`node:sqlite` と型ストリッピングを使うため）。
リポジトリ本体は Node 22.11 で動いとるので、bench を回すときだけ 24 に切り替えること。

モデルの差し替えは環境変数1個。モデルは消耗品、台が資産。

```bash
BENCH_MODEL=qwen/qwen-2.5-72b-instruct pnpm run run -- --turns=20
```

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `BENCH_MODEL` | `deepseek/deepseek-chat` | OpenRouter のモデル ID |
| `BENCH_RESPONSE_LENGTH` | `400` | 1発話に期待する文字数（長さ軸の分母） |
| `BENCH_MAX_TOKENS` | `3072` | 上限トークン |
| `BENCH_PORT` | `8791` | `serve` の待受ポート |

追加の口（`script/compare.ts` の `--conditions` から渡す）:
`frequencyPenalty` / `presencePenalty` / `temperature` / `maxTokens` / `useXmlEnvelope` / `stripTags`。

`OPENROUTER_API_KEY` はリポジトリ直下の `.dev.vars` から読む。ベンチ用に鍵を新しく配ることはせん。

## 機械7軸

| 軸 | 見るもの | 実装 |
|---|---|---|
| 日本語の壊れ | 簡体字混入・文字種比率 | `detectSimplified` / `charClassRatio` |
| 長さ | 指定に対する実文字数 | `charCount` / `lengthRatio` |
| 空返信 | 本文が空か | `isEmptyReply` |
| 反復 | 直前発話との 5-gram 重複率 | `ngramOverlap` |
| AI臭 | 禁止フレーズ辞書のヒット数 | `AI_SMELL_PHRASES` |
| エスカレーション | 強度語彙の時系列の傾き | `intensityScore` + `slope` |
| タグ漏れ | `<response>` 等が生で残っとらんか | `detectLeakedTags` |

**「抜けたか」は機械に判定させへん。** 最後まで人間の1軸として残す。
キャラ一貫性と showing 比は LLM 判定なので P5 以降。

## 基準線（テストに焼いてある）

`.work/backups/chat-history/20260628T101036/d1-full.sql` に対する実測値。
数字がズレたら、疑うのは計測スクリプトの側や。

| 指標 | 期待値 |
|---|---|
| assistant 発話数 | 334 |
| 空返信 | 62 (18.6%) |
| 空を除いた median 文字数 | 154 |
| 200字未満 | 234 |
| `<response>` タグが生残りしとる発話 | 135 |
| AI臭ヒット | 6 |
| 拒否・メタ発言ヒット | 8 |
| 反復（直前との5-gram重複） | mean 0.221 / p90 0.621 / n 158 |
| 会話数 / 2ターン以内で終了 | 57 / 43 |
| 台由来の死に方（返事なし＋空で終了） | 6（2 + 4） |
| 簡体字を含む発話 | **2**（計画の 24 は誤り。下記） |

### 簡体字 24件/29文字 は全数が偽陽性やった

前身の分析は次のリストを「簡体字」として使うとった。

```
们么这说过来会对现发应该样没让给还关问觉认为从东车马鸟鱼头汉语习爱买卖无个亿边远进运动员经济轻齐风飞热长
```

この中の **「来」「会」「没」は日本語の常用漢字**や。実測すると 29 文字の内訳は
`来:21 / 会:8` で、簡体字は 1 文字も含まれとらん。24件/29文字 は下限やのうて過大計上やった。

日本語では使わん簡体字だけを 686 字集めて測り直した結果、実際の混入は
**2 発話・2 文字（`舍` `处`）**。`char-set.ts` の `JAPANESE_SHARED_FALSE_POSITIVES` に
偽陽性の元を並べて、テストで交わらんことを担保しとる。

## 設計上の割り切り

- **保存先は JSONL 1本**（`.data/turns.jsonl`）。D1 も Dexie も使わん。
  1万件を超えて検索が要る段になったら SQLite に移す。
- **ストリーミングはやらん。** 既存は buffer-then-replay でストリームの体をなしてへん。
  まず正しく返る方を取る。first-token 到達時間は P4 で別途測る。
- **first-token 8秒打ち切りは持ち込まん。** 既存 `functions/api/[[route]].ts:460` の
  `FIRST_TOKEN_TIMEOUT_MS = 8_000` が空返信の容疑者やから、台の側では再現条件として作る。
- **シナリオの user 発話は実物を再生する。** AI に代理生成させるとユーザーターン自体が
  AI 臭くなってテストの意味が消える。`loadReplayScenario` が既存会話の user 発話を順に流す。
- **Hono は入れとらん。** 計画では Hono worker 1本やったが、workspace 外に置く以上
  依存を1つでも足すと lockfile の管理が要る。エンドポイント3つは `node:http` で同じもんが出る。

## ディレクトリ

```
apps/bench/
  README.md
  package.json          独立。ルートの workspace には入れん
  src/lib/
    text-metric.ts      機械7軸の純粋関数
    feedback.ts         P5 の👍の口（会話の終わり1回＋任意votes）
    char-set.ts         簡体字判定の文字集合（偽陽性の記録つき）
    corpus.ts           既存 D1 ダンプの読み込み（本番 D1 には繋がへん）
    scenario.ts         既存会話の user 発話を再生する
    openrouter.ts       非ストリーミングの生成呼び出し
    prompt.ts           system prompt 1本＋長さ指定だけの組み立て
    bench.ts            1ターン / N ターンの実行
    score.ts            run 単位の機械7軸集計
    store.ts            JSONL 追記・読み出し
    config.ts           モデル・長さ・上限トークンの既定値
  src/server.ts         POST /turn, POST /run, GET /score
  script/
    baseline.ts         既存 334 発話の基準線
    turn.ts             P1: 1ターン
    run.ts              P2: Nターン
    compare.ts          P4: 条件比較
    probe.ts            P3: 死因の再現
    score.ts feedback.ts
```

実測した結果は [FINDINGS.md](./FINDINGS.md)。承認済みの計画は [PLAN.md](./PLAN.md)。

## lint について

`apps/` を `eslint.config.js` の `globalIgnores` に足す案は**要らんくなった**。
bench 側をルートの eslint 設定に合わせたので、`pnpm lint` はリポジトリ全体で 0 エラーのまま通る。
既存ファイルは1行も触っとらん。
