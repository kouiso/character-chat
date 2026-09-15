# LLM router architecture

Issue: [#50](https://github.com/kouiso/adult-ai-app/issues/50)

This experiment is implemented as an opt-in router in front of the existing phase router.

## Runtime switch

Set `LLM_ROUTER_ENABLED=1` to enable one router call before the main chat generation request. Without this flag, production behavior remains the existing rule-based phase routing.

Optional:

- `LLM_ROUTER_MODEL`: override the router model. Default is `anthropic/claude-haiku-4-5-20251001`.

## Flow

```text
requested model + scene phase + recent turns
  -> Router LLM
  -> { qwen | magnum | euryale, reason }
  -> existing provider request + fallback chain
```

The router is bounded to `500ms`. On timeout, HTTP error, malformed output, or any exception, it returns `DEFAULT_CHAT_MODEL` and lets the existing phase/fallback routing continue.

## Choices

| Router key | Model                          |
| ---------- | ------------------------------ |
| `qwen`     | `qwen/qwen-2.5-72b-instruct`   |
| `magnum`   | `anthracite-org/magnum-v4-72b` |
| `euryale`  | `sao10k/l3.3-euryale-70b`      |

Router decisions are logged with `console.info("[model-routing] llm router decision", ...)` for debugging.
