import { LOADING_PLACEHOLDER_PATTERN } from "./loading-placeholder";

import type { Page } from "playwright";

export const TURN_TIMEOUT_MS = 300_000;
export const SCENARIO_TIMEOUT_MS = 2_700_000;
export const RUN_TIMEOUT_MS = 3_600_000;

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const STREAM_STABLE_MS = 500;
const POLL_INTERVAL_MS = 100;
const MESSAGE_GROUP_SELECTOR = '[data-testid="message-bubble"]';
const BUBBLE_SELECTOR = ".rounded-2xl";

interface ProbeSnapshot {
  installedAt: number | null;
  lastChatRequestAt: number | null;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  doneChunkAt: number | null;
  // 採用された本文を生成したモデル。quality-meta で届く。
  servedModel: string | null;
  // 作り直しが宣言された回数。1文字目の時刻はこの回数だけ捨てて測り直しとる。
  regeneratedCount: number;
}

interface AssistantSnapshot {
  exists: boolean;
  text: string;
  messageCount: number;
  hasUiDone: boolean;
}

interface ImageSnapshot {
  naturalWidth: number;
  src: string | null;
}

interface MessageCountSnapshot {
  count: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const parseProbeSnapshot = (value: unknown): ProbeSnapshot => {
  if (!isRecord(value)) {
    return {
      installedAt: null,
      lastChatRequestAt: null,
      firstChunkAt: null,
      lastChunkAt: null,
      doneChunkAt: null,
      servedModel: null,
      regeneratedCount: 0,
    };
  }

  return {
    installedAt: readFiniteNumber(value.installedAt),
    lastChatRequestAt: readFiniteNumber(value.lastChatRequestAt),
    firstChunkAt: readFiniteNumber(value.firstChunkAt),
    lastChunkAt: readFiniteNumber(value.lastChunkAt),
    doneChunkAt: readFiniteNumber(value.doneChunkAt),
    servedModel: typeof value.servedModel === "string" ? value.servedModel : null,
    regeneratedCount: readFiniteNumber(value.regeneratedCount) ?? 0,
  };
};

const parseAssistantSnapshot = (value: unknown): AssistantSnapshot => {
  if (!isRecord(value)) {
    return {
      exists: false,
      text: "",
      messageCount: 0,
      hasUiDone: false,
    };
  }

  return {
    exists: readBoolean(value.exists) ?? false,
    text: readString(value.text) ?? "",
    messageCount: readFiniteNumber(value.messageCount) ?? 0,
    hasUiDone: readBoolean(value.hasUiDone) ?? false,
  };
};

const parseImageSnapshot = (value: unknown): ImageSnapshot => {
  if (!isRecord(value)) {
    return { naturalWidth: 0, src: null };
  }

  return {
    naturalWidth: readFiniteNumber(value.naturalWidth) ?? 0,
    src: readString(value.src),
  };
};

const parseMessageCountSnapshot = (value: unknown): MessageCountSnapshot => {
  if (!isRecord(value)) {
    return { count: 0 };
  }

  return {
    count: readFiniteNumber(value.count) ?? 0,
  };
};

// OpenAI互換ストリームは role だけのフレームで開く。これを1文字目として数えると
// TTFT が本文到着より短く出るので、実際に表示される文字を持つフレームだけを数える。
// ページ内へ toString() で注入するため、外側のスコープを参照したらあかん。
export const sseFrameHasVisibleText = (payload: string): boolean => {
  if (!payload || payload === "[DONE]") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const record = parsed as {
    text?: unknown;
    content?: unknown;
    choices?: { delta?: { content?: unknown } }[];
  };
  const candidates = [record.text, record.content, record.choices?.[0]?.delta?.content];
  return candidates.some((value) => typeof value === "string" && value.length > 0);
};

export interface StreamProbeLineState {
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  doneChunkAt: number | null;
  servedModel: string | null;
  currentEvent: string | null;
  regeneratedCount: number;
}

// 計測の中身はページ内へ toString() で注入するので、外側のスコープを参照したらあかん
// （同じスコープに注入する sseFrameHasVisibleText だけは参照してええ）。
// ここで単体テストできる形にしておかんと、SSE の書式ゆれで計測が黙って null になる。
export const handleProbeSseLine = (
  state: StreamProbeLineState,
  rawLine: string,
  now: number,
): void => {
  // 上流のフレームはそのまま中継されるので CRLF で届くことがある。\r を残すと空行判定が
  // 外れ、以降の data 行が全部イベント配下の扱いになって計測が止まる。
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (line === "") {
    state.currentEvent = null;
    return;
  }
  if (line.startsWith("event:")) {
    state.currentEvent = line.slice(6).trim();
    // 作り直しが宣言された時点で、それまでに出た本文はクライアントが捨てる。
    // 1文字目の時刻を持ち越すと、ユーザーが実際に読む本文の待ち時間より短く出て、
    // 10秒ゲートが実態と関係なく通ってまう。
    if (state.currentEvent === "regenerating") {
      state.firstChunkAt = null;
      state.regeneratedCount += 1;
    }
    return;
  }
  // 空白なしの "data:{...}" も SSE として正しい形。
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload) return;

  // 名前付きイベントの data は本文やない。本文の到着時刻として数えると
  // 作り直し通知が1文字目扱いになってTTFTが実際より短く出る。
  if (state.currentEvent !== null) {
    if (state.currentEvent === "quality-meta") {
      try {
        const meta = JSON.parse(payload) as { usedModel?: unknown };
        if (typeof meta.usedModel === "string") state.servedModel = meta.usedModel;
      } catch {
        // 壊れた行は無視する
      }
    }
    return;
  }

  if (state.firstChunkAt === null && sseFrameHasVisibleText(payload)) {
    state.firstChunkAt = now;
  }
  if (payload === "[DONE]") {
    state.doneChunkAt = now;
  } else {
    state.lastChunkAt = now;
  }
};

export const ensureStreamProbe = async (page: Page): Promise<void> => {
  await page.evaluate(`
    (() => {
      const key = "__adultAiE2eStreamProbe";
      const scope = window;
      const sseFrameHasVisibleText = ${sseFrameHasVisibleText.toString()};
      const handleProbeSseLine = ${handleProbeSseLine.toString()};
      if (scope[key]) {
        return;
      }

      const state = {
        installedAt: Date.now(),
        lastChatRequestAt: null,
        firstChunkAt: null,
        lastChunkAt: null,
        doneChunkAt: null,
        servedModel: null,
        currentEvent: null,
        regeneratedCount: 0,
      };

      const originalFetch = window.fetch.bind(window);
      const parseUrl = (input) => {
        if (typeof input === "string") return input;
        if (input instanceof URL) return input.toString();
        if (input && typeof input === "object" && "url" in input && typeof input.url === "string") {
          return input.url;
        }
        return "";
      };

      const inspectResponse = async (response) => {
        try {
          const cloned = response.clone();
          if (!cloned.body) {
            return;
          }
          const reader = cloned.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          state.currentEvent = null;
          const handleLine = (line) => handleProbeSseLine(state, line, Date.now());

          while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }
            if (!chunk.value) {
              continue;
            }

            buffer += decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              handleLine(line);
            }
          }

          // 改行で終わらん最後の行を捨てると [DONE] を取り逃がし、待ち側が
          // タイムアウトまで待ち続ける。
          buffer += decoder.decode();
          if (buffer) {
            handleLine(buffer);
          }
        } catch {
          return;
        }
      };

      window.fetch = async (...args) => {
        const url = parseUrl(args[0]);
        const isChat = url.includes("/api/chat");
        if (isChat) {
          // 送信の前に打つ。await の後やと「ヘッダが返った時刻」が基準になり、
          // サーバの思考時間がまるごと TTFB から抜ける（実測: TTFB 1ms / total 5ms）。
          state.lastChatRequestAt = Date.now();
          state.firstChunkAt = null;
          state.lastChunkAt = null;
          state.doneChunkAt = null;
          state.servedModel = null;
          state.regeneratedCount = 0;
        }
        const response = await originalFetch(...args);
        if (isChat) {
          void inspectResponse(response);
        }
        return response;
      };

      scope[key] = state;
    })()
  `);
};

const readProbeSnapshot = async (page: Page): Promise<ProbeSnapshot> => {
  const raw = await page.evaluate(`
    (() => {
      const state = window.__adultAiE2eStreamProbe;
      if (!state) {
        return null;
      }
      return {
        installedAt: state.installedAt,
        lastChatRequestAt: state.lastChatRequestAt,
        firstChunkAt: state.firstChunkAt,
        lastChunkAt: state.lastChunkAt,
        doneChunkAt: state.doneChunkAt,
        servedModel: state.servedModel ?? null,
        regeneratedCount: state.regeneratedCount ?? 0,
      };
    })()
  `);
  return parseProbeSnapshot(raw);
};

const readAssistantSnapshot = async (page: Page): Promise<AssistantSnapshot> => {
  const raw = await page.evaluate(`
    (() => {
      const groups = Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_GROUP_SELECTOR)}));
      // Ouse: user messages have justify-end, AI messages do not
      const assistantGroups = groups.filter((node) => !node.classList.contains("justify-end"));
      const last = assistantGroups.at(-1);
      if (!last) {
        return { exists: false, text: "", messageCount: assistantGroups.length, hasUiDone: false };
      }

      // Collect text from all <p> tags inside the bubble (works for both Ouse and old chat-view).
      // Ouse HerMessage renders scene/action/dialogue/inner as separate <p> elements inside .min-w-0.
      // During streaming, StreamingContent renders <span class="whitespace-pre-wrap"> (no <p>).
      // Fallback chain: <p> → span.whitespace-pre-wrap → full bubble textContent.
      const paras = Array.from(last.querySelectorAll("p"));
      let text = paras.map((p) => p.textContent?.trim() ?? "").filter(Boolean).join(" ")
        || last.querySelector("span.whitespace-pre-wrap")?.textContent?.trim()
        || last.querySelector(".min-w-0")?.textContent?.trim()
        || last.querySelector(${JSON.stringify(BUBBLE_SELECTOR)})?.textContent?.trim()
        || last.textContent?.trim()
        || "";
      // Ouse のローディング文言はテキストとして描画されるため「安定した本文」と
      // 誤認され Fallback B が早期解決する（実証: run-20260711-225243 T2-T5 が
      // 「ことばを探している…」のまま完了扱い）。プレースホルダーは空とみなす。
      // 判定は loading-placeholder.ts に集約。ここはブラウザ側で評価されるため
      // 関数を渡せず、正規表現リテラルとして埋め込む。
      if (${LOADING_PLACEHOLDER_PATTERN.toString()}.test(text.trim())) text = "";
      const hasStreamingDots = Boolean(last.querySelector(".animate-bounce"));
      // Ouse has no 再生成/再試行 buttons; rely on stream probe's doneChunkAt for completion
      const hasReadyActions = Boolean(
        last.querySelector('button[aria-label="再生成"], button[aria-label="再試行"]'),
      );

      return {
        exists: true,
        text,
        messageCount: assistantGroups.length,
        hasUiDone: hasReadyActions && !hasStreamingDots,
      };
    })()
  `);
  return parseAssistantSnapshot(raw);
};

const readImageSnapshot = async (page: Page, imgSelector: string): Promise<ImageSnapshot> => {
  const raw = await page.evaluate(`
    (() => {
      const img = document.querySelector(${JSON.stringify(imgSelector)});
      if (!(img instanceof HTMLImageElement)) {
        return { naturalWidth: 0, src: null };
      }
      return {
        naturalWidth: img.naturalWidth,
        src: img.currentSrc || img.src || null,
      };
    })()
  `);
  return parseImageSnapshot(raw);
};

const readMessageCount = async (page: Page): Promise<number> => {
  const raw = await page.evaluate(`
    (() => ({
      count: document.querySelectorAll(${JSON.stringify(MESSAGE_GROUP_SELECTOR)}).length,
    }))()
  `);
  return parseMessageCountSnapshot(raw).count;
};

const toAbsoluteUrl = (pageUrl: string, src: string): string => {
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return src;
  }
};

const readContentType = async (page: Page, src: string): Promise<string | null> => {
  try {
    const response = await page.context().request.get(src, {
      failOnStatusCode: false,
      timeout: DEFAULT_WAIT_TIMEOUT_MS,
    });
    return response.headers()["content-type"] ?? null;
  } catch {
    return null;
  }
};

export const waitForDomReady = async (
  page: Page,
  selector: string,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<void> => {
  await page.waitForSelector(selector, {
    state: "visible",
    timeout: timeoutMs,
  });
};

export const waitForStreamComplete = async (
  page: Page,
  timeoutMs = TURN_TIMEOUT_MS,
  requestIssuedAfterMs?: number,
): Promise<{
  firstTokenMs: number | null;
  lastChunkMs: number | null;
  hasDoneSignal: boolean;
  // 採用本文を生成したモデル。x-model-used ヘッダは1トークン目で固定され作り直しに追随せん。
  servedModel: string | null;
  // 作り直しが宣言された回数。firstTokenMs はこの回数だけ測り直しとる。
  regeneratedCount: number;
}> => {
  await ensureStreamProbe(page);

  const startedAt = Date.now();
  let firstTokenMs: number | null = null;
  let seenRegeneratedCount = 0;
  let lastChunkMs: number | null = null;
  let previousText = "";
  let stableSince = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const [probe, assistant] = await Promise.all([
      readProbeSnapshot(page),
      readAssistantSnapshot(page),
    ]);
    const now = Date.now();

    // 逐次配信では1文字目が1〜2秒で届くため、送信クリックから fetch 発行までの数百msの隙間に
    // 前ターンの doneChunkAt がそのまま残り「もう完了しとる」と誤判定して1文字だけ拾ってまう。
    // このターンの要求が実際に飛んだことを確認するまで、probe の値を一切採用せん。
    const hasFreshRequest =
      requestIssuedAfterMs === undefined ||
      (probe.lastChatRequestAt !== null && probe.lastChatRequestAt >= requestIssuedAfterMs);

    if (!hasFreshRequest) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (assistant.text !== previousText) {
      previousText = assistant.text;
      stableSince = now;
      if (assistant.text.length > 0) {
        if (firstTokenMs === null) {
          firstTokenMs = now - startedAt;
        }
        lastChunkMs = now - startedAt;
      }
    }

    // DOM由来の1文字目も、作り直しが宣言されたら捨てる。probe 側だけ捨てても
    // こちらが残っとると、捨てられた本文の時刻がそのまま結果になる。
    if (probe.regeneratedCount > seenRegeneratedCount) {
      seenRegeneratedCount = probe.regeneratedCount;
      firstTokenMs = null;
    }

    const probeBase = probe.lastChatRequestAt ?? probe.installedAt;
    if (probeBase !== null && probe.firstChunkAt !== null) {
      firstTokenMs = Math.max(0, probe.firstChunkAt - probeBase);
    }
    if (probeBase !== null && probe.lastChunkAt !== null) {
      lastChunkMs = Math.max(0, probe.lastChunkAt - probeBase);
    }

    const hasDoneSignal = probe.doneChunkAt !== null;
    const stableForMs = now - stableSince;
    // Ouse has no 再生成/再試行 buttons so hasUiDone is always false.
    // Primary: probe saw [DONE] chunk — sufficient on its own.
    // Fallback A: old-style UI has ready actions and text is stable.
    // Fallback B: text is non-empty and stable (probe may have missed chunks if installed late).
    const hasFallbackDone = assistant.hasUiDone && stableForMs >= STREAM_STABLE_MS;
    const hasTextStable = assistant.text.length > 0 && stableForMs >= STREAM_STABLE_MS;

    // After [DONE], wait for text to appear in DOM (React may still be rendering).
    // Give up waiting after 3s so we don't stall indefinitely on empty responses.
    const msSinceDone = probe.doneChunkAt !== null ? now - probe.doneChunkAt : 0;
    if (hasDoneSignal && (hasTextStable || msSinceDone > 3_000)) {
      return {
        firstTokenMs,
        lastChunkMs,
        hasDoneSignal: true,
        servedModel: probe.servedModel,
        regeneratedCount: probe.regeneratedCount,
      };
    }
    if (hasFallbackDone) {
      return {
        firstTokenMs,
        lastChunkMs,
        hasDoneSignal,
        servedModel: probe.servedModel,
        regeneratedCount: probe.regeneratedCount,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`stream complete wait timed out after ${timeoutMs}ms`);
};

export const waitForImageLoaded = async (
  page: Page,
  imgSelector: string,
  timeoutMs = TURN_TIMEOUT_MS,
): Promise<{
  naturalWidth: number;
  contentType: string | null;
}> => {
  await page.waitForSelector(imgSelector, {
    state: "attached",
    timeout: timeoutMs,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await readImageSnapshot(page, imgSelector);
    if (snapshot.naturalWidth > 0 && snapshot.src) {
      const absoluteSrc = toAbsoluteUrl(page.url(), snapshot.src);
      const contentType = await readContentType(page, absoluteSrc);
      return {
        naturalWidth: snapshot.naturalWidth,
        contentType,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`image load wait timed out after ${timeoutMs}ms for selector: ${imgSelector}`);
};

export const waitForMessageCount = async (
  page: Page,
  expected: number,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<number> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const count = await readMessageCount(page);
    if (count >= expected) {
      return count;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`message count wait timed out after ${timeoutMs}ms, expected=${expected}`);
};
