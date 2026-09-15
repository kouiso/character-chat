# 1文字目の速さを測るハーネス

チャットの返信が「何秒で読めるようになるか」を実APIで測る。#946 / #983 / #989 で使った。

## 測る値の違い（ここを間違えると結論が逆になる）

| 値 | 意味 |
|---|---|
| `ttfcMs` | **表示された**1文字目。作り直しが起きると捨てられる |
| `ttfcAfterLastRegenMs` | **画面に残る**1文字目。ユーザーが実際に読むのはこっち |
| `regenAtMs` | 作り直しが宣言された時刻の一覧 |
| `failedChecks` | 作り直しの原因になった品質検査の名前 |

要件の判定に使うのは `ttfcAfterLastRegenMs`。`ttfcMs` だけ見ると、ユーザーが
30秒待っとるターンでも「5秒で届いた」と読めてまう。

## 使い方

```bash
cp ~/ghq/kouiso/adult-ai-app/.dev.vars .dev.vars   # 終わったら必ず消す
pnpm build
npx wrangler d1 migrations apply adult-ai-db --local
npx wrangler pages dev dist --port 8804 --local &

PORT=8804 N=10 node script/e2e/ttft/run.mjs
node script/e2e/ttft/summarize.mjs
```

`run.mjs` は worker のログを `worker.log` から読む。worker の出力先を変えたら
`LOG` の定義も合わせる。

## 条件（cell）

| cell | 入力 | 狙い |
|---|---|---|
| 1 | 約58,000字 + 曖昧な最終行 | 長文かつフェーズ再判定が走る経路 |
| 2 | 約58,000字 | 長文のみ |
| 3 | 短い1往復 | 短文の対照 |

## 数字を出す時の作法

2026-07-27 に、数字は本物なのに結論を3回間違えた。同じ轍を踏まんように。

1. **残る方を測る。** 上の表のとおり。
2. **作り直しを除いて集計する。** モデルの速さを言う時は `regenerating === 0` の
   回だけを使う。混ぜると p95 が跳ねて「モデルが遅い」と読めてまう
   （実例: deepseek の p95 が 9,250ms → 除外すると 3,511ms）。
3. **測った時間帯を書く。** 同じコードで、朝は11秒台・昼は54回中10秒超えゼロ
   やった。上流の速さが窓で大きく変わるので、窓を書かん数字は判定に使えん。
