# runner 直書き検査

GitHub-hosted と Blacksmith の runner 名は `vars.RUNNER_*` 経由で指定する。
`runs-on` と、そこから参照する `strategy.matrix` の値だけを検査する。
関係のない image / tag 軸は検査しない。

## ローカル実行

Python 3 と、固定バージョンの PyYAML が必要。
CI は同じ requirements を専用の仮想環境へ導入する。
ローカルの `task ci` / `node .github/ci/run.mjs runner-guard` も、先に以下を実行する。

```sh
python3 -m venv "$HOME/.venvs/character-runner-guard"
. "$HOME/.venvs/character-runner-guard/bin/activate"
python3 -m pip install -r .github/script/requirements-runner-guard.txt
python3 .github/script/test-runner-hardcode.py
bash .github/script/check-runner-hardcode.sh
```

外部生成された matrix、動的キー、wildcard、数値添字は静的に確定できないためエラーになる。
選択した軸の値が式の場合も、`vars.RUNNER_*` 以外は同じ理由でエラーになる。
循環する YAML エイリアスもエラーにする。同じエイリアスの再利用は許可する。
固定のドット記法・文字列キーのブラケット記法・ネストしたプロパティは検査できる。
キーは GitHub runner と同じく大小文字を区別しない。
根拠は [DictionaryContextData](https://github.com/actions/runner/blob/main/src/Sdk/DTPipelines/Pipelines/ContextData/DictionaryContextData.cs) の `StringComparer.OrdinalIgnoreCase`。

不正な YAML、対象ファイルなし、依存不足も非ゼロ終了になる。
式の評価器ではないため、文字列連結で組み立てた runner 名の評価は対象外。
`inputs` や `needs` など非 matrix の実行時値は取得せず、式に含まれる直書きだけを検査する。
