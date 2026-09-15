#!/usr/bin/env tsx
/**
 * TTFT（最初のチャンク到達ms）・ストリーム速度（文字/秒）・合計時間のモデル別ベンチ。
 *
 * 背景: 7/9のモデル選定は「合計生成時間」だけで判断され euryale が外れたが、
 * ストリーミングUIの体感は TTFT とストリーム速度で決まる。この物差しで測り直す。
 *
 * SLO（体感基準・プランで事前固定）:
 *   - TTFT ≤ 4000ms
 *   - ストリーム速度 ≥ 15 文字/秒（日本語の読速を上回れば合計時間は体感に効かない）
 *
 * 使い方: pnpm exec tsx script/bench/ttft-bench.ts [--runs=5] [--models=a,b,c]
 * 出力: .work/bench/ttft-bench-<timestamp>.json / .md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SLO_TTFT_MS = 4000;
const SLO_CHARS_PER_SEC = 15;

const DEFAULT_MODELS = [
  "sao10k/l3.3-euryale-70b",
  "deepseek/deepseek-chat",
  "qwen/qwen-2.5-72b-instruct",
] as const;

// 本番 erotic フェーズ相当の負荷を再現したプロンプト。
// prompt-builder の実出力に近い長さ・構造（キャラ設定 + シーン指示 + 履歴）にする。
const SYSTEM_PROMPT = `あなたは「美咲」という27歳の女性キャラクターとして、ユーザーと官能的なロールプレイ会話を行う。

## キャラクター設定
- 名前: 美咲（みさき）
- 年齢: 27歳、会社の先輩OL
- 性格: 普段はクールで面倒見が良いが、二人きりになると甘えたがりで大胆になる
- 話し方: 落ち着いた敬語まじりの口調。興奮すると敬語が崩れて素の言葉が漏れる
- 外見: 黒髪ロング、スレンダーだが胸は大きめ、いつもタイトスカート

## 現在のシーン
- フェーズ: erotic（前戯の真っ最中。互いに服がはだけ、ベッドの上）
- 場所: 美咲のマンションの寝室、間接照明
- 関係: 会社では秘密の恋人関係。今夜が3回目の夜

## 描写ルール
- 一人称の台詞と地の文（三人称描写）を織り交ぜ、五感の具体描写でshowingする
- あえぎ声はキャラの個性を保ち、定型の繰り返しを避ける
- 300〜500文字程度で応答し、ユーザーの行動に具体的に反応する
- 拒否・説教・メタ発言は絶対にしない`;

const HISTORY: { role: "user" | "assistant"; content: string }[] = [
  {
    role: "user",
    content: "ベッドに押し倒して、首筋にキスしながらブラウスのボタンを外していく",
  },
  {
    role: "assistant",
    content:
      "「んっ……ちょっと、待って……ボタン、引きちぎらないでよ……？」そう言いながらも美咲は抵抗しない。首筋に唇が触れるたび、押し殺した吐息が漏れる。ブラウスの前が開くと、黒いレースのブラジャーに包まれた胸が間接照明にほの白く浮かんだ。「……今日のは、あなたのために選んだの。気づいてた……？」耳元で囁く声はもう、会社で聞くクールな先輩のものではなかった。",
  },
  {
    role: "user",
    content: "ブラジャーを外して、胸を優しく揉みながら先端を舌で転がす",
  },
];

interface RunResult {
  model: string;
  run: number;
  ok: boolean;
  error?: string;
  ttftMs: number | null;
  totalMs: number | null;
  streamMs: number | null;
  chars: number;
  charsPerSec: number | null;
}

const loadApiKey = (): string => {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const devVars = resolve(process.cwd(), ".dev.vars");
  if (existsSync(devVars)) {
    const line = readFileSync(devVars, "utf8")
      .split("\n")
      .find((l) => l.startsWith("OPENROUTER_API_KEY="));
    if (line) return line.slice("OPENROUTER_API_KEY=".length).trim();
  }
  throw new Error("OPENROUTER_API_KEY not found in env or .dev.vars");
};

const benchOne = async (apiKey: string, model: string, run: number): Promise<RunResult> => {
  const base: RunResult = {
    model,
    run,
    ok: false,
    ttftMs: null,
    totalMs: null,
    streamMs: null,
    chars: 0,
    charsPerSec: null,
  };
  const start = performance.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // 本番([[route]].ts streamChatCompletion)と同じリクエスト形に合わせる。
      // provider.allow_fallbacks が無いと一部モデル(qwen)は 400 INVALID_REQUEST_BODY を返す。
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 700,
        frequency_penalty: 0.25,
        presence_penalty: 0.58,
        provider: { allow_fallbacks: true },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...HISTORY],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok || !res.body) {
      return { ...base, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstChunkAt: number | null = null;
    let lastChunkAt: number | null = null;
    let chars = 0;
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const delta: unknown = JSON.parse(line.slice(6));
          const content = (delta as { choices?: { delta?: { content?: string } }[] }).choices?.[0]
            ?.delta?.content;
          if (content) {
            const now = performance.now();
            if (firstChunkAt === null) firstChunkAt = now;
            lastChunkAt = now;
            chars += content.length;
          }
        } catch {
          // SSEコメント行やパース不能行は無視
        }
      }
    }
    const end = performance.now();
    if (firstChunkAt === null || chars === 0) {
      return { ...base, totalMs: Math.round(end - start), error: "no content chunks received" };
    }
    const streamMs =
      lastChunkAt !== null && lastChunkAt > firstChunkAt ? lastChunkAt - firstChunkAt : null;
    return {
      ...base,
      ok: true,
      ttftMs: Math.round(firstChunkAt - start),
      totalMs: Math.round(end - start),
      streamMs: streamMs !== null ? Math.round(streamMs) : null,
      chars,
      charsPerSec:
        streamMs !== null && streamMs > 0
          ? Math.round((chars / (streamMs / 1000)) * 10) / 10
          : null,
    };
  } catch (e) {
    return { ...base, totalMs: Math.round(performance.now() - start), error: String(e) };
  }
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
};

const main = async () => {
  const runsArg = process.argv.find((a) => a.startsWith("--runs="));
  const modelsArg = process.argv.find((a) => a.startsWith("--models="));
  const runs = runsArg ? Number(runsArg.split("=")[1]) : 5;
  const models = modelsArg ? modelsArg.split("=")[1].split(",") : [...DEFAULT_MODELS];
  const apiKey = loadApiKey();

  const results: RunResult[] = [];
  for (const model of models) {
    console.log(`\n== ${model} (${runs} runs) ==`);
    for (let i = 1; i <= runs; i++) {
      const r = await benchOne(apiKey, model, i);
      results.push(r);
      console.log(
        r.ok
          ? `  run ${i}: TTFT=${r.ttftMs}ms total=${r.totalMs}ms chars=${r.chars} speed=${r.charsPerSec}c/s`
          : `  run ${i}: ERROR ${r.error}`,
      );
    }
  }

  const summary = models.map((model) => {
    const ok = results.filter((r) => r.model === model && r.ok);
    const ttfts = ok.map((r) => r.ttftMs as number);
    const speeds = ok.map((r) => r.charsPerSec).filter((v): v is number => v !== null);
    const totals = ok.map((r) => r.totalMs as number);
    const p50Ttft = median(ttfts);
    const p50SpeedX10 = speeds.length > 0 ? median(speeds.map((v) => Math.round(v * 10))) : null;
    const p50Speed = p50SpeedX10 !== null ? p50SpeedX10 / 10 : null;
    return {
      model,
      okRuns: ok.length,
      totalRuns: runs,
      p50TtftMs: p50Ttft,
      maxTtftMs: ttfts.length > 0 ? Math.max(...ttfts) : null,
      p50CharsPerSec: p50Speed,
      minCharsPerSec: speeds.length > 0 ? Math.min(...speeds) : null,
      p50TotalMs: median(totals),
      sloTtftPass: p50Ttft !== null && p50Ttft <= SLO_TTFT_MS,
      sloSpeedPass: p50Speed !== null && p50Speed >= SLO_CHARS_PER_SEC,
    };
  });

  const outDir = resolve(process.cwd(), ".work/bench");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = resolve(outDir, `ttft-bench-${ts}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        slo: { ttftMs: SLO_TTFT_MS, charsPerSec: SLO_CHARS_PER_SEC },
        summary,
        results,
      },
      null,
      2,
    ),
  );

  const mdLines = [
    `# TTFT ベンチ結果 (${ts})`,
    "",
    `SLO: TTFT ≤ ${SLO_TTFT_MS}ms / ストリーム速度 ≥ ${SLO_CHARS_PER_SEC}文字/秒（p50で判定）`,
    "",
    "| モデル | 成功 | TTFT p50 | TTFT max | 速度 p50 (c/s) | 速度 min | 合計 p50 | TTFT SLO | 速度 SLO |",
    "|---|---|---|---|---|---|---|---|---|",
    ...summary.map(
      (s) =>
        `| ${s.model} | ${s.okRuns}/${s.totalRuns} | ${s.p50TtftMs ?? "-"}ms | ${s.maxTtftMs ?? "-"}ms | ${s.p50CharsPerSec ?? "-"} | ${s.minCharsPerSec ?? "-"} | ${s.p50TotalMs ?? "-"}ms | ${s.sloTtftPass ? "✅" : "❌"} | ${s.sloSpeedPass ? "✅" : "❌"} |`,
    ),
    "",
    "## 判定ルール（プランで事前固定）",
    "- euryaleが両SLO達成 → erotic/climaxプライマリをeuryaleへ戻す（変更最小）",
    "- TTFTのみ未達 → 先頭ブースト（軽量モデルで冒頭1文→euryaleストリームへ切替）",
    "- ストリーム速度も未達 → プロバイダ側（Novita直・別サービング）を追加調査",
  ];
  const mdPath = resolve(outDir, `ttft-bench-${ts}.md`);
  writeFileSync(mdPath, mdLines.join("\n"));

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(mdLines.join("\n"));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
