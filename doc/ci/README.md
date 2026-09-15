# doc/ci — CI ワークフローの控えと経緯

`dogfood-arm.yml` は **2026-08-21 に `.github/workflows/` へ入った**。ここに残っとるのは
「なんでこの形なんか」の経緯だけで、走るのは `.github/workflows/dogfood-arm.yml` の方や。

## dogfood-arm.yml — 実測アームを CI で回す

### 何のためか

抜き所の長さ（issue #1495 L1-3）と通読判定（L2-b）は、実際に生成した本文を読まんと
判定でけへん。

### なんで CI やないとあかんのか（2026-08-21 に確定）

**この環境の egress ポリシーが `openrouter.ai` を拒否しとる。**ローカルで worker を起てても、
上流呼び出しが全部 403 で返る:

```
Host not in allowlist: openrouter.ai. Add this host to your network egress settings to allow access.
```

qwen / deepseek / euryale の 3 モデルとも同じ。証拠は
`.work/e2e-results/vlong-dogfood/2026-08-21-phase67/`（2 ターンとも HTTP 502・servedModel 無し）。
proxy の README も「403 は組織のポリシー拒否。迂回するな、報告しろ」と明記しとる。

`OPENROUTER_API_KEY` そのものは git-crypt を開ければ手元でも読める（2026-08-21 に読めた）。
**詰まりは鍵やのうて経路。**CI のランナーには egress の制限が無く、鍵も repo secret として
既に在る（`quality-eval.yml` が同じ鍵で走っとる）ので、アームは CI でだけ回せる。

### 走らせ方

**push の先端コミットの**メッセージに `[arm]` を入れる。

```bash
git commit -m "fix(quality): 何かの修正 [arm]"
git push
```

**`[arm]` が無い push では 1 円も使わん。**

⚠️ トリガーは `github.event.head_commit.message` を見る＝**push の先端 1 個だけ**。
2 コミットまとめて push する時に `[arm]` を古い方へ入れると skipped になる
（2026-08-21 の run #1 がこれで空振りした）。**必ず最後のコミットへ入れる。**

⚠️⚠️ **背景で push する時は、先端が「起動時」やのうて「実行時」の HEAD になる。**
`git push` は pre-push フック（`task ci:fast` は 50〜250 秒かかる）を通した**後**に
その時点の HEAD を送る。フックが走っとる間に別のコミットを積むと、**そっちが先端になって
`[arm]` が押し出される**。2026-08-21 に `d9b2add`（`[arm]` 付き）がこれで空振りし、
docs コミットが先端になって skipped になった。

**対策: `[arm]` 付きの push が着地するまで、他のコミットを積まん。**
着地は `git log --oneline -1 origin/<branch>` で確かめる。ログの
`To https://...` の行が出た時点の先端が、実際にトリガーへ渡る先端。

### 課金の目安

1 アーム = 20 ターン。既定で 2 本回す（後述）。上限は `VLONG_BUDGET_CENTS`（既定 1700 = $17/本）が
握っとるが、実測はそれよりずっと下。

### なんで既定 2 本か

`doc/dogfood/vlong-2026-08-20.md` §28 の帯: **同じコードで到達数が 2/6 〜 5/6 に振れる**。
1 本だけ回しても前と比べられん。**1 本 vs 1 本の比較は禁止**とあの節が書いた根拠がこれ。

### 積んである歯止め（全部、過去に踏んだ罠から）

| 歯止め | 由来 |
|---|---|
| `[arm]` が無いと走らん | 普通の push で課金せん |
| `TEST_FORCE_CHAT_MODEL` が立っとったら開始前に落ちる | 罠 §5-1。フェーズ別ルーティングが無効なまま測って半日溶かした |
| `LOCAL_AUTH_BYPASS=1` を書く | これが無いと `/api/*` が 401 を返し、下の存在チェックで落ちてアームが 1 本も回らん（2026-08-21 にローカルで実際に踏んだ） |
| 2 体のキャラが D1 に居ることを金を使う前に確かめる | migration だけでは 123 体で桜庭さくらが居らん。`pnpm db:seed` まで要る |
| 既定 2 本 | 罠: 1 本の到達数はコードの差やない |
| ジョブ内で recheck も回してログへ残す | 成果物を落とせん時でもログから数字が読める |
| 全文をブランチへコミットして戻す | issue §8「実測の全文は必ずコミットする」 |
