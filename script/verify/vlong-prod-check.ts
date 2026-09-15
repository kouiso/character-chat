/**
 * vlong-prod-check.ts — 本番 /api/chat で Sakura/Downer の very_long が
 * conversation/erotic/climax すべてで 1300 可視文字を超えるか検証する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseXmlResponse } from "../../src/lib/xml-response-parser";
import { readChatSseResponse } from "../lib/read-chat-sse";

const loadVars = (): Record<string, string> => {
  const varsPath = resolve(process.cwd(), ".prod-verify.vars");
  const lines = readFileSync(varsPath, "utf8").split("\n");
  return Object.fromEntries(
    lines
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      }),
  );
};

const vars = loadVars();
const BASE_URL =
  process.env.PROD_BASE_URL ?? vars["PROD_BASE_URL"] ?? "https://adult-ai-chat.pages.dev";
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? vars["AUTH_TOKEN"] ?? "";
const FLOOR = 1300;

const scenarios = [
  { characterId: "char-koharu-ex", name: "Sakura" },
  { characterId: "import-charap-ダウナーお姉さんに拾われる話", name: "Downer" },
];

const phases = ["conversation", "erotic", "climax"] as const;

const phasePrompt: Record<(typeof phases)[number], string> = {
  conversation: "こんにちは、今日はどう過ごしてる？",
  erotic: "もっと近づいて……きみのこと、もっと感じさせて。",
  climax: "もう我慢できない……いっしょに果てよう。",
};

// her-message.tsx と同じく <inner> は UI 非表示なので、可視文字数には含めない。
const countVisible = (text: string): number => {
  const parsed = parseXmlResponse(text);
  if (!parsed) return text.replace(/\s+/g, "").length;
  const visible = [parsed.scene, parsed.action, parsed.dialogue, parsed.narration]
    .filter((section): section is string => typeof section === "string")
    .join("");
  return visible.replace(/\s+/g, "").length;
};

const countInner = (text: string): number => {
  const parsed = parseXmlResponse(text);
  if (!parsed?.inner) return 0;
  return parsed.inner.replace(/\s+/g, "").length;
};

const RESULT_DIR = resolve(process.cwd(), ".work/results");
if (!existsSync(RESULT_DIR)) mkdirSync(RESULT_DIR, { recursive: true });

const cfFetch = async (path: string, body: string, timeoutMs = 240_000) => {
  const url = new URL(path, BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "User-Agent": "adult-ai-vlong-verify/1.0",
      },
      body,
      signal: controller.signal,
    });
    if (res.status !== 200) {
      const bodyText = await res.text();
      return { ok: false, status: res.status, body: bodyText, model: null, text: "" };
    }
    const snapshot = await readChatSseResponse(res.body as ReadableStream<Uint8Array>);
    return {
      ok: true,
      status: 200,
      body: "",
      model: snapshot.servedModel,
      text: snapshot.text,
      error: snapshot.errorReason,
      done: snapshot.doneSignal,
    };
  } finally {
    clearTimeout(timer);
  }
};

async function main() {
  console.log(`BASE_URL: ${BASE_URL}`);
  const results: {
    character: string;
    phase: string;
    visible: number;
    model: string | null;
    error?: string;
    pass: boolean;
  }[] = [];

  for (const { characterId, name } of scenarios) {
    for (const phase of phases) {
      const payload = JSON.stringify({
        messages: [{ role: "user", content: phasePrompt[phase] }],
        model: "qwen/qwen-2.5-72b-instruct",
        safeMode: false,
        characterId,
        responseLength: "very_long",
        scenePhase: phase,
      });
      console.log(`\n[${name}] phase=${phase} -> POST /api/chat`);
      const r = await cfFetch("/api/chat", payload);
      if (!r.ok) {
        console.error(`  status ${r.status}: ${r.body.slice(0, 200)}`);
        results.push({ character: name, phase, visible: 0, model: null, error: `${r.status} ${r.body.slice(0, 120)}`, pass: false });
        continue;
      }
      const visible = countVisible(r.text);
      const inner = countInner(r.text);
      const total = r.text.replace(/\s+/g, "").length;
      const pass = visible > FLOOR;
      const safeId = `${name}-${phase}`.replace(/[^a-zA-Z0-9\-_]/g, "_");
      writeFileSync(resolve(RESULT_DIR, `vlong-${safeId}.txt`), r.text, "utf8");
      console.log(`  model=${r.model ?? "(none)"} visible=${visible} inner=${inner} total=${total} pass=${pass} done=${r.done} error=${r.error ?? "-"}`);
      if (!pass) {
        console.log(`  text (first 240): ${r.text.slice(0, 240).replace(/\n/g, " ")}`);
      }
      results.push({ character: name, phase, visible, model: r.model, error: r.error ?? undefined, pass });
    }
  }

  console.log("\n=== SUMMARY ===");
  for (const row of results) {
    const mark = row.pass ? "PASS" : "FAIL";
    console.log(`${mark}: ${row.character}/${row.phase} visible=${row.visible} model=${row.model ?? "-"} ${row.error ?? ""}`);
  }
  const allPass = results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
