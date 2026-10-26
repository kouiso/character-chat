import { AsyncLocalStorage } from "node:async_hooks";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenRouter } from "@langchain/openrouter";

const requestContext = new AsyncLocalStorage<string>();
const State = Annotation.Root({ text: Annotation<string>() });

// この probe は必ず loopback の合成応答へ接続し、実 API にフォールバックしない。
const localModel = (baseURL: string | undefined): ChatOpenRouter => {
  const url = new URL(baseURL ?? "https://invalid.invalid");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error("Only a loopback mock endpoint is allowed");
  }
  return new ChatOpenRouter({
    model: "synthetic/local-mock",
    apiKey: "synthetic-local-only",
    baseURL: url.href.replace(/\/$/, ""),
    maxRetries: 0,
  });
};

export default {
  fetch(request: Request, env: { MOCK_BASE_URL?: string }): Response {
    if (new URL(request.url).pathname !== "/turn") return new Response(null, { status: 404 });
    const id = request.headers.get("x-probe-id") ?? "synthetic";
    const model = localModel(env.MOCK_BASE_URL);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (type: string, text: string) => {
          controller.enqueue(
            new TextEncoder().encode(
              `event: ${type}\ndata: ${JSON.stringify({ text, requestId: requestContext.getStore() })}\n\n`,
            ),
          );
        };
        try {
          await requestContext.run(id, async () => {
            const graph = new StateGraph(State)
              .addNode("generate", async () => {
                let text = "";
                for await (const chunk of await model.stream("synthetic input")) {
                  if (typeof chunk.content === "string" && chunk.content) {
                    text += chunk.content;
                    send("token", chunk.content);
                  }
                }
                return { text };
              })
              .addEdge(START, "generate")
              .addEdge("generate", END)
              .compile();
            const result = await graph.invoke({ text: "" });
            send("done", result.text);
          });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<{ MOCK_BASE_URL?: string }>;
