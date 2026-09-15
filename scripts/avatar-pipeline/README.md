# アバター再生成パイプライン

1回の実行で1キャラクターを処理します。

```bash
python3 scripts/avatar-pipeline/run.py --root ~/avatar-pipeline
```

パイロット実行（固定3ID）:

```bash
python3 scripts/avatar-pipeline/run.py --root ~/avatar-pipeline --pilot-ids "import-charap-xxx,import-saylo-yyy,import-broken-zzz"
```

## 補助コマンド

### `d1_fetch.ts`

`char_id` を受け取り、D1 (`adult-ai-db`) の `character` テーブルから対象レコードを取得して標準出力へ JSON を返します。

```bash
pnpm exec tsx scripts/avatar-pipeline/d1_fetch.ts <char_id>
# => {"name":"...","system_prompt":"...","visualPrompt":"..."}
```

### `d1_update.ts`

`char_id`, `avatar_path`, `prompt` を受け取り、`character.avatar` と `character.visualPrompt` を更新します。

```bash
pnpm exec tsx scripts/avatar-pipeline/d1_update.ts <char_id> <avatar_path> <prompt>
```

### `judge.sh`

`--a` (テキスト仕様 JSON), `--b` (画像PNG), `--out` (判定JSON出力先) を受け取り、厳格な8軸重み付きルーブリックで判定します。

```bash
bash scripts/avatar-pipeline/judge.sh --a /tmp/a-text.json --b /tmp/candidate.png --out /tmp/verdict.json
# verdict.json => {"result":"PASS|FAIL","refinement_hint":"..."}
```

Judgeは常にexit code 0を返し、判定は `--out` ファイルで受け取ります。

## 必須環境変数

- `NOVITA_API_KEY`
- 任意の上書き:
  - `D1_FETCH_CMD`
  - `D1_UPDATE_CMD`
  - `WSL_JUDGE_CMD`
  - `NOVITA_URL`
  - `NOVITA_MODEL`

## 状態管理

`state.json` にIDごとの進行状態（queued/generating/judging/passed/manual_queue）を保存します。

## フルパイプライン例

```bash
export NOVITA_API_KEY="..."
python3 scripts/avatar-pipeline/run.py --root ~/avatar-pipeline --pilot-ids "import-charap-001"
```
