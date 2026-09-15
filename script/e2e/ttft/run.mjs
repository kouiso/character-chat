import fs from "node:fs";
import path from "node:path";
import { buildCase, totalChars } from "./cases.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const LOG = path.join(DIR, "worker.log");
const OUT = path.join(DIR, "raw-runs.jsonl");
const PORT = process.env.PORT ?? "8804";
const N = Number(process.env.N ?? "10");

const logSize = () => {
  try {
    return fs.statSync(LOG).size;
  } catch {
    return 0;
  }
};
const logSlice = (from) => {
  const fd = fs.openSync(LOG, "r");
  const size = fs.statSync(LOG).size;
  const len = Math.max(0, size - from);
  const buf = Buffer.alloc(len);
  if (len > 0) fs.readSync(fd, buf, 0, len, from);
  fs.closeSync(fd);
  return buf.toString("utf8");
};

const runOne = async (cell, seed) => {
  const messages = buildCase(cell, seed);
  const body = JSON.stringify({ messages, responseLength: "medium" });
  const logFrom = logSize();
  const t0 = Date.now();
  let ttfc = null;
  let firstChar = null;
  let headersAt = null;
  let regenerating = 0;
  const regenAtMs = [];
  let ttfcAfterRegen = null;
  let qualityMeta = null;
  let pendingQualityMeta = false;
  let bytes = 0;
  let error = null;
  let status = null;
  let usedModel = null;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    headersAt = Date.now() - t0;
    status = res.status;
    usedModel = res.headers.get("x-model-used");
    if (!res.ok || !res.body) {
      error = `http_${res.status}: ${(await res.text()).slice(0, 200)}`;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.startsWith("event: regenerating")) {
            regenerating += 1;
            regenAtMs.push(Date.now() - t0);
            // 再生成が起きたら、それまでに出した文字はクライアントが捨てる。
            // 何回目の作り直し後の1文字目かを別に持つ。
            ttfcAfterRegen = null;
            continue;
          }
          if (line.startsWith("event: quality-meta")) {
            pendingQualityMeta = true;
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          if (pendingQualityMeta) {
            pendingQualityMeta = false;
            try {
              qualityMeta = JSON.parse(line.slice(6).trim());
            } catch {
              /* noop */
            }
            continue;
          }
          const data = line.slice(6).trim();
          if (data === "[DONE]" || data === "" || data === "{}") continue;
          let content;
          try {
            content = JSON.parse(data)?.choices?.[0]?.delta?.content;
          } catch {
            continue;
          }
          if (typeof content === "string" && content.length > 0) {
            if (ttfc === null) {
              ttfc = Date.now() - t0;
              firstChar = content[0];
            }
            if (ttfcAfterRegen === null) ttfcAfterRegen = Date.now() - t0;
          }
        }
      }
    }
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const totalMs = Date.now() - t0;
  const logs = logSlice(logFrom);
  const hedge = (logs.match(/first-token hedge started/g) ?? []).length;
  // どの検査で落ちて作り直しになったかを残す。回数だけ数えても、何を直せばええかが
  // 分からんまま measurement が終わる（2026-07-27 に1日分そうなった）。
  const failedChecks = [...logs.matchAll(/\[quality\] attempt \d+ failed: ([^\u001b\n]+)/g)].map(
    (m) => m[1].trim(),
  );
  const reaskLines = logs
    .split("\n")
    .filter((l) => l.includes("phase_de_escalation_classifier"));
  let reaskLatency = null;
  let reaskDecision = null;
  if (reaskLines.length > 0) {
    const m = reaskLines[0].match(/\{.*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        reaskLatency = parsed.latencyMs;
        reaskDecision = `${parsed.source}/${parsed.deEscalate}`;
      } catch {
        /* noop */
      }
    }
  }
  return {
    cell,
    seed,
    at: new Date().toISOString(),
    inputChars: totalChars(messages),
    status,
    headersAtMs: headersAt,
    ttfcMs: ttfc,
    ttfcAfterLastRegenMs: ttfcAfterRegen,
    firstChar,
    totalMs,
    bytes,
    regenerating,
    regenAtMs,
    failedChecks,
    qualityMeta,
    hedgeFired: hedge > 0,
    hedgeCount: hedge,
    reaskFired: reaskLines.length > 0,
    reaskLatencyMs: reaskLatency,
    reaskDecision,
    usedModel,
    error,
  };
};

const results = [];
fs.writeFileSync(OUT, "");
for (let i = 0; i < N; i += 1) {
  for (const cell of [1, 2, 3]) {
    const r = await runOne(cell, i + 1);
    results.push(r);
    fs.appendFileSync(OUT, `${JSON.stringify(r)}\n`);
    console.log(
      `[${i + 1}/${N}] cell${cell} ttfc=${r.ttfcMs} post=${r.ttfcAfterLastRegenMs} total=${r.totalMs} regenAt=${JSON.stringify(r.regenAtMs)} hedge=${r.hedgeFired} reask=${r.reaskFired}(${r.reaskLatencyMs}) regen=${r.regenerating} err=${r.error ?? "-"}`,
    );
    await new Promise((res) => setTimeout(res, 1500));
  }
}
console.log("DONE", results.length);
