// .codex/mock-server.mjs — offline mock for the external APIs adult-ai-app calls.
//
// Why: the app talks to OpenRouter, Anthropic and Novita via hard-coded https
// URLs. In the Codex Cloud container there is no network and no real keys, so
// integration tests / a locally-run worker point their fetch at THIS server
// (base URL = MOCK_API_BASE, default http://127.0.0.1:8790) to get deterministic,
// provider-shaped responses. Zero external network, zero real payment.
//
// Dependency-free (Node built-ins only). Start with: node .codex/mock-server.mjs
//
// Routes (mirrors the shapes the code in functions/api/ expects):
//   GET  /health                       -> { ok: true }
//   POST /api/v1/chat/completions       -> OpenRouter/OpenAI chat completion
//                                          (SSE when body.stream === true)
//   POST /v1/messages                   -> Anthropic messages response
//   POST /v3/async/txt2img              -> Novita async init  { task_id }
//   POST /v3/async/img2img              -> Novita async init  { task_id }
//   GET  /v3/async/task-result?task_id= -> Novita result (points at /mock-image.png)
//   GET  /mock-image.png                -> a 1x1 PNG (local, no network)
//   POST /api/v1/model/uploadMedia      -> AtlasCloud image upload (returns /mock-image.png)
//   POST /api/v1/model/generateVideo    -> AtlasCloud video init { id }
//   GET  /api/v1/model/prediction/:id   -> AtlasCloud result (points at /mock-video.mp4)
//   GET  /mock-video.mp4                -> a 1s 32x32 MP4 (local, no network)
//   *                                   -> { ok: true, mock: true } (never hang)

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? process.env.CODEX_MOCK_PORT ?? 8790);
const HOST = process.env.MOCK_HOST ?? "127.0.0.1";

// 決定論的な返答本文（テストが内容を assert できるよう固定）。
const MOCK_ASSISTANT_TEXT =
  "<response>これはCodexコンテナのモック応答です。外部ネットワークには一切アクセスしていません。</response>";

// 4コマ漫画のコマ分解は response_format: json_object で呼ばれ、panels を4件ちょうど要求する
// (comicPanelBreakdownSchema)。散文を返すと必ず JSON パースで落ちて、コミック生成が
// オフラインでは一度も通らん。JSON モードの要求には JSON を返す。
const MOCK_COMIC_BREAKDOWN = {
  panels: [
    { visual_prompt: "1girl, office, standing, looking at viewer", dialogue: "…まだ残ってたの？" },
    { visual_prompt: "1girl, office, sitting at desk, side view", dialogue: "別にあんたのためじゃないから。" },
    { visual_prompt: "1girl, office, leaning closer, blushing", dialogue: "……ちょっとだけなら、いてあげる。" },
    { visual_prompt: "1girl, office, smiling softly, night window", dialogue: "感謝しなさいよ。" },
  ],
};

// JSON モード(response_format.type === "json_object")の呼び出しには JSON 文字列を返す。
// コマ分解だけは専用スキーマがあるので、プロンプトから判別して形の合う JSON を返す。
const chatCompletionContent = (body) => {
  if (body?.response_format?.type !== "json_object") return MOCK_ASSISTANT_TEXT;
  const prompt = JSON.stringify(body?.messages ?? "");
  if (prompt.includes("panels") || prompt.includes("コマ")) {
    return JSON.stringify(MOCK_COMIC_BREAKDOWN);
  }
  return "{}";
};

// 1x1 透明 PNG（base64）と 1 秒 32x32 MP4。実メディア取得を無ネットワークで代替する。
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const ONE_SECOND_MP4 = readFileSync(new URL("mock-video.mp4", import.meta.url));

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

// OpenAI/OpenRouter 形式の SSE ストリーム。ai-sdk / 生 fetch の両方が読める形。
const streamChatCompletion = (res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const id = "chatcmpl-mock";
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 1735689600,
      model: "mock/model",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  res.write(chunk({ role: "assistant" }));
  for (const piece of MOCK_ASSISTANT_TEXT.match(/.{1,24}/gs) ?? [MOCK_ASSISTANT_TEXT]) {
    res.write(chunk({ content: piece }));
  }
  res.write(chunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (path === "/health") return json(res, 200, { ok: true, mock: true });

  if (path === "/mock-image.png") {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": ONE_BY_ONE_PNG.length,
    });
    return res.end(ONE_BY_ONE_PNG);
  }

  // OpenRouter / OpenAI chat completions
  if (path === "/api/v1/chat/completions" && req.method === "POST") {
    const body = await readBody(req);
    if (body.stream) return streamChatCompletion(res);
    return json(res, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 1735689600,
      model: body.model ?? "mock/model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: chatCompletionContent(body) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }

  // Runware 同期 inference。body は [{taskType:"authentication"}, {taskType:"imageInference"}] の配列で、
  // レスポンスは data[] に同じ taskUUID を返す（runware-provider.ts の parseImages が突き合わせる）。
  if (path === "/v1" && req.method === "POST") {
    const body = await readBody(req);
    const tasks = Array.isArray(body) ? body : [];
    const inference = tasks.find((t) => t && t.taskType === "imageInference");
    if (!inference) return json(res, 400, { errors: [{ message: "no imageInference task" }] });
    return json(res, 200, {
      data: [
        {
          taskType: "imageInference",
          taskUUID: inference.taskUUID,
          imageURL: `http://${HOST}:${PORT}/mock-image.png`,
          seed: 12345,
        },
      ],
    });
  }

  // Anthropic messages
  if (path === "/v1/messages" && req.method === "POST") {
    return json(res, 200, {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: "mock-claude",
      content: [{ type: "text", text: MOCK_ASSISTANT_TEXT }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }

  // Novita async image init
  if ((path === "/v3/async/txt2img" || path === "/v3/async/img2img") && req.method === "POST") {
    return json(res, 200, { task_id: "mock-task-0001" });
  }

  // Novita async result
  if (path === "/v3/async/task-result") {
    return json(res, 200, {
      task: { task_id: "mock-task-0001", status: "TASK_STATUS_SUCCEED", progress_percent: 100 },
      images: [{ image_url: `http://${HOST}:${PORT}/mock-image.png`, image_type: "png" }],
      provider: "novita",
    });
  }

  // AtlasCloud uploadMedia
  if (path === "/api/v1/model/uploadMedia" && req.method === "POST") {
    return json(res, 200, {
      code: 200,
      data: { download_url: `http://${HOST}:${PORT}/mock-image.png` },
    });
  }

  // AtlasCloud generateVideo
  if (path === "/api/v1/model/generateVideo" && req.method === "POST") {
    return json(res, 200, { code: 200, data: { id: "mock-task-video-1" } });
  }

  // AtlasCloud prediction result
  if (path.startsWith("/api/v1/model/prediction/")) {
    return json(res, 200, {
      code: 200,
      data: {
        status: "completed",
        outputs: [`http://${HOST}:${PORT}/mock-video.mp4`],
      },
    });
  }

  // mock video file for AtlasCloud video persist test
  if (path === "/mock-video.mp4") {
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": ONE_SECOND_MP4.length,
    });
    return res.end(ONE_SECOND_MP4);
  }

  // 何が来ても 200 を返してテストをハングさせない。
  return json(res, 200, { ok: true, mock: true, path, method: req.method });
});

server.listen(PORT, HOST, () => {
  // console はこの CLI の唯一の出力手段（stdout に直接書き lint の no-console を避ける）。
  process.stdout.write(`[codex-mock] listening on http://${HOST}:${PORT} (no external network)\n`);
});
