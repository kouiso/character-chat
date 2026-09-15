# NSFW chat model investigation: 2026-05-24

Issue: [#233](https://github.com/kouiso/adult-ai-app/issues/233)

## Recommendation

Keep `anthracite-org/magnum-v4-72b` as the primary NSFW roleplay model for erotic/climax turns.

Use `qwen/qwen-2.5-72b-instruct` as the normal Japanese conversation default and fallback. Trial Novita direct only for Qwen/DeepSeek fallback traffic before moving production away from OpenRouter, because the current best NSFW catalog model is Anthracite/Magnum and the app already phase-routes adult peaks to it.

## Ranking

| Rank | Provider / path | Model | Use | Notes |
| --- | --- | --- | --- | --- |
| 1 | Anthracite via current OpenRouter-compatible path | `anthracite-org/magnum-v4-72b` | Primary NSFW chat | Roleplay/prose-tuned Qwen2.5-72B derivative. Best fit for explicit Japanese adult RP when quality matters more than long context. |
| 2 | Novita direct | Qwen / DeepSeek family | Fallback trial | OpenAI-compatible chat endpoint and low published token prices. Good candidate for direct-provider fallback validation. |
| 3 | Together direct | DeepSeek / Qwen / Llama family | Infra fallback | Broad serverless open-model catalog. Useful if Novita reliability fails, but not the first NSFW prose choice. |
| 4 | Replicate | DeepSeek/custom deployments | Ops experiment | Strong for custom model hosting, but less attractive for immediate chat UX because pricing/latency depends on model or hardware path. |

## Evidence notes

- Anthracite model card describes Magnum v4 72B as Qwen2.5-72B based and designed for Claude-like prose quality: https://huggingface.co/anthracite-org/magnum-v4-72b
- Novita publishes an OpenAI-compatible chat completions endpoint: https://novita.ai/docs/api-reference/model-apis-llm-create-chat-completion
- Novita pricing lists Qwen/DeepSeek contexts and per-token rates, including long-context DeepSeek and Qwen options: https://novita.ai/pricing
- Together publishes broad serverless model API/pricing coverage for open models including DeepSeek, Qwen, and Llama: https://www.together.ai/pricing
- Replicate pricing supports hosted model and custom deployment paths, but operational cost is less direct for this app's immediate chat routing: https://replicate.com/pricing

## App decision

- `DEFAULT_CHAT_MODEL` remains `qwen/qwen-2.5-72b-instruct` for ordinary chat.
- `EROTIC_CHAT_MODEL` remains `anthracite-org/magnum-v4-72b`.
- `NSFW_CHAT_MODEL_RECOMMENDATION` records the product decision in code so Settings copy, tests, and future routing changes stay aligned.
