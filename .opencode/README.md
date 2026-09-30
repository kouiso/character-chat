# opencode 設定

OpenRouter 経由で **実装 = DeepSeek V4 Pro**、**エロ品質レビュー = Grok 4.20** の二本立て。

## セットアップ

```bash
export OPENROUTER_API_KEY=sk-or-v1-...   # 1Password: OpenRouter API Key - coding
opencode                                  # 既定モデル = deepseek-v4-pro
```

## 運用ループ

1. 実装は既定の build エージェント（DeepSeek V4 Pro）で普通に進める
2. 台本・芯・prompt・出力契約をいじったら、**レビュー前に `@grok-reviewer` を呼ぶ**

   ```
   @grok-reviewer この diff をレビューして: <変更内容>
   @grok-reviewer この transcript を採点して: <生成会話を貼る or ファイルを読ませる>
   ```

3. Grok の「要修正」指摘を DeepSeek に反映して再生成 → 再レビュー。採用が出るまで回す

## モデル切替

- 小さい雑務は `small_model`（v4-flash）が自動で使われる
- 一時的に別モデルにしたい場合は opencode 内のモデル切替で `openrouter/<provider>/<model>` を指定（例: `openrouter/moonshotai/kimi-k2`）

## コスト目安

- V4 Pro: ~$0.5-1.5/時（実装連続稼働）
- Grok 4.20: $1.25/$2.5 per 1M — レビューは diff + transcript 抜粋を渡すので1回数セント級。全量を毎回投げない
