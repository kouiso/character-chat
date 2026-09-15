import { promises as fs } from "node:fs";
import path from "node:path";

import { getQueue } from "./action-queue";
import { buildLocalAuthHeaders } from "./auth";
import { heartbeat, closeContext, createContext } from "./browser";
import {
  SCENARIO_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
  ensureStreamProbe,
  waitForMessageCount,
  waitForStreamComplete,
} from "./browser-wait";
import { setupFreshConversation } from "./conversation-setup";
import { classifyFailure, type FailureCategory } from "./failure-taxonomy";
import {
  computeExpectedPersistedCount,
  countPersistedGreetings,
  runD1PersistenceJudge,
  waitForD1Durability,
} from "./judges/d1-persistence";
import { probeR2Stages, runR2PersistenceJudge } from "./judges/r2-persistence";
import { judgePhaseWithLlm } from "./judges/scene-phase-llm";
import { selectRecentTurnsForClassifier } from "./persisted-history";
import { runUISuccessJudge } from "./judges/ui-success";
import { stripLoadingPlaceholder } from "./loading-placeholder";
import { clickSendIfEnabledInPage, type SendButtonClickResult } from "./send-button-click";
import {
  DEFAULT_SEND_TURN_BUDGET,
  fitSendPhaseToRemaining,
  sendTurnMessage,
  type ComposerState,
} from "./send-turn";
import {
  appendImage,
  appendTurn,
  atomicWriteJson,
  getScenarioDir,
  getScenarioImagesDir,
} from "./manifest";

import type { E2eEnv } from "./env";
import type {
  JudgeVerdict,
  JudgeVerdictSet,
  Phase,
  ScenarioId,
  ScenarioResult,
  TurnFailure,
  TurnResult,
} from "./types";
import { PHASES } from "./types";
import type { Browser, ConsoleMessage, Page, Response } from "playwright";

export type ScenarioDefinition = {
  scenarioId: ScenarioId;
  characterSlug: string;
  turns: Array<{
    turnIndex: number;
    userMsg: string;
    expectedPhase: Phase;
    characterSlug?: string;
    isCreampie?: boolean;
    isImageTrigger?: boolean;
    isMonkey?: boolean;
    monkeyKind?: string;
    isSubtextProbe?: boolean;
  }>;
  onFailFast?: (turn: number, failureCategory: FailureCategory) => boolean;
};

type QualityGuardEvent = {
  attempt: number;
  passed: boolean;
  failedCheck: string | null;
  message: string;
  ts: number;
};

type ChatResponseEvent = {
  usedModel: string | null;
  scenePhase: Phase | null;
  ts: number;
};

type PersistedMessage = {
  id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  imageUrl?: string | null;
};

const MESSAGE_GROUP_SELECTOR = '[data-testid="message-bubble"]';
// placeholder は UI 世代によって ASCII 3 点リーダーと日本語の 3 点リーダーが混在するため両方許容する。
const INPUT_SELECTOR = 'textarea[placeholder$="..."], textarea[placeholder$="…"]';
const SEND_BUTTON_SELECTOR =
  'button[title="送信"], button[aria-label="送信"], button[data-testid="send-button"]';
const IMAGE_SELECTOR = 'img[alt*="からの写真"]';
const RETRY_BUTTON_SELECTOR = 'button[aria-label="再試行"]';
const E2E_STRICT_QUALITY_STORAGE_KEY = "e2e-strict-quality";
const MAX_STRICT_QUALITY_FINAL_FAIL_TURNS = 3;
const RETRY_BUTTON_ENABLE_WAIT_MS = 30_000;
// 永続化は実測で 100ms 未満に収まる（D1 barrier も 8 秒で足りる想定）。
// ターン全体の持ち時間を渡すと、送信とストリームで消費した後にもう一度 300 秒待てて
// しまい、シナリオの締切を大きく超える。専用の短い上限で切る。
const PERSIST_SETTLE_WAIT_MS = 15_000;
// user message が DOM に入った後、assistant プレースホルダーが並ぶまでの待ち。
// 同一 tick で addMessage される想定なので短くてよい。
const SEND_ECHO_SETTLE_MS = 15_000;
// 送信フェーズの上限に足す余白。ターン予算（300 秒）をそのまま渡すと外側の
// withTimeout が先に発火して、原因が "turn-N-send timed out" に潰れる（#993）。
// 逆に内側の総和より短くしても同じことが起きるため、上限は予算から導出する
// （fitSendPhaseToRemaining）。残り時間が総和に足りないターンでは内側ごと縮める。
// 余白には送信後の SEND_ECHO_SETTLE_MS と、計測開始から sendTurnMessage 到達までの
// 前処理（ensureStreamProbe / オーバーレイ解除）ぶんを含める。
const SEND_PHASE_PREAMBLE_MARGIN_MS = 30_000;
const SEND_PHASE_MARGIN_MS = SEND_ECHO_SETTLE_MS + SEND_PHASE_PREAMBLE_MARGIN_MS;
const TURN_PAD = 2;
const RECENT_PHASE_WINDOW_TURNS = 7;
const SCENE_PHASES = new Set<string>(PHASES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPhase = (value: string | null): value is Phase => value !== null && SCENE_PHASES.has(value);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const toFailureDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const formatTurn = (turnIndex: number): string => String(turnIndex).padStart(TURN_PAD, "0");

const waitForLatestRetryButtonEnabled = async (
  page: Page,
  timeoutMs = RETRY_BUTTON_ENABLE_WAIT_MS,
): Promise<boolean> => {
  try {
    await page.waitForFunction(
      (selector: string) => {
        const buttons = Array.from(document.querySelectorAll(selector));
        const latest = buttons.at(-1);
        return latest instanceof HTMLButtonElement && !latest.disabled;
      },
      RETRY_BUTTON_SELECTOR,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
};

// composer の状態を 1 往復でまとめて読む。textarea の disabled は ou-app.tsx の
// isLoading に直結しているため、送信できない原因が isLoading なのか入力未反映なのかを
// 失敗メッセージの中で切り分けられる（#993 では両者が同じ症状に見えていた）。
const readComposerState = async (page: Page): Promise<ComposerState> =>
  page.evaluate(
    ([inputSelector, buttonSelector, groupSelector]) => {
      const textarea = document.querySelector(inputSelector) as HTMLTextAreaElement | null;
      const button = document.querySelector(buttonSelector) as HTMLButtonElement | null;
      return {
        textareaFound: textarea !== null,
        textareaDisabled: textarea === null || textarea.disabled,
        textareaLength: textarea?.value.length ?? 0,
        buttonFound: button !== null,
        buttonDisabled: button === null || button.disabled,
        renderedMessageCount: document.querySelectorAll(groupSelector).length,
      };
    },
    [INPUT_SELECTOR, SEND_BUTTON_SELECTOR, MESSAGE_GROUP_SELECTOR] as const,
  );

// disabled 判定・当たり判定・click・click 直前の描画数読みを同一の同期タスクで実行する。
// disabled 判定と click を別ステップへ分けると、その隙間で isLoading が true へ戻り、
// click は発火するのに handleSend が即 return する（#993）。
// 描画数を別の page.evaluate で読むと、その隙間に挨拶や前ターンの遅延描画が割り込んで
// 増えることがあり、click が不発でもその無関係な増分だけで送信成功と誤判定する（#997 再指摘）。
// 本体は send-button-click.ts（テスト付き）。
const clickSendIfEnabled = async (page: Page): Promise<SendButtonClickResult> =>
  page.evaluate(clickSendIfEnabledInPage, [SEND_BUTTON_SELECTOR, MESSAGE_GROUP_SELECTOR] as const);

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const scenarioSnapshotPath = (runDir: string, scenarioId: ScenarioId): string =>
  path.join(getScenarioDir(runDir, scenarioId), "scenario.partial.json");

const writeScenarioSnapshot = async (runDir: string, scenario: ScenarioResult): Promise<void> => {
  await atomicWriteJson(scenarioSnapshotPath(runDir, scenario.scenarioId as ScenarioId), scenario);
};

const parsePersistedMessages = (value: unknown): PersistedMessage[] => {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return [];
  }

  return value.messages.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const role = readString(entry.role);
    const content = readString(entry.content);
    const imageUrl = entry.imageUrl === null ? null : readString(entry.imageUrl);
    if ((role === "user" || role === "assistant" || role === "system") && content !== null) {
      return [{ id: readString(entry.id), role, content, imageUrl }];
    }
    return [];
  });
};

const countPersistedImageMessages = (messages: PersistedMessage[]): number =>
  messages.filter((message) => message.role === "assistant" && typeof message.imageUrl === "string")
    .length;

const listPersistedMessages = async (
  page: Page,
  env: E2eEnv,
  conversationId: string,
): Promise<PersistedMessage[]> => {
  const response = await page
    .context()
    .request.get(
      `${env.devOrigin}/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        failOnStatusCode: false,
        headers: buildLocalAuthHeaders(env.userEmail),
        timeout: 5_000,
      },
    );
  if (!response.ok()) {
    throw new Error(`list messages failed: ${response.status()}`);
  }
  const payload: unknown = await response.json();
  return parsePersistedMessages(payload);
};

// 待ち文言の除去が呼び出し側で効いとることをテストから確かめるため export する。
export const readAssistantText = async (page: Page): Promise<string> =>
  (async () => {
    const count = await page.locator(MESSAGE_GROUP_SELECTOR).count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const group = page.locator(MESSAGE_GROUP_SELECTOR).nth(index);
      const className = (await group.getAttribute("class")) ?? "";
      // Ouse: user bubble has bg-gradient-user-bubble; old chat-view used justify-end or flex-row-reverse
      if (
        className.includes("bg-gradient-user-bubble") ||
        className.includes("justify-end") ||
        className.includes("flex-row-reverse")
      )
        continue;
      // Ouse HerMessage renders text as <p> tags inside .min-w-0.
      // Collect all <p> text; fallback to .min-w-0 or .rounded-2xl container.
      const paras = group.locator("p");
      const paraCount = await paras.count();
      let text = "";
      if (paraCount > 0) {
        const texts = await paras.allTextContents().catch(() => [] as string[]);
        // 待ち文言は本文と同じ <p> に出る。ここで落とさんと下の fallback へ進まず、
        // 「ことばを探している…」がアシスタントの発言として記録される。
        text = stripLoadingPlaceholder(
          texts
            .map((t) => t.trim())
            .filter(Boolean)
            .join(" ")
            .trim(),
        );
      }
      if (!text) {
        // her-message.tsx renders each part (action/dialogue/inner) as its own
        // span.whitespace-pre-wrap — must join ALL of them, not just .first(), or
        // multi-part responses truncate to only the first layer.
        const spans = group.locator("span.whitespace-pre-wrap");
        const spanCount = await spans.count();
        if (spanCount > 0) {
          const texts = await spans.allTextContents().catch(() => [] as string[]);
          text = stripLoadingPlaceholder(
            texts
              .map((t) => t.trim())
              .filter(Boolean)
              .join(" ")
              .trim(),
          );
        }
      }
      if (!text) {
        // .min-w-0 is outside [data-testid="message-bubble"]; try full bubble textContent as fallback
        text = stripLoadingPlaceholder(
          ((await group.textContent({ timeout: 3_000 }).catch(() => "")) ?? "").trim(),
        );
      }
      return text;
    }
    return "";
  })();

const readRenderedMessageCount = async (page: Page): Promise<number> =>
  page.locator(MESSAGE_GROUP_SELECTOR).count();

// textarea の disabled は ou-app.tsx の isLoading に直結しており、isLoading は
// persistCompletedTurn の完了後に false へ戻る。よって「入力欄が有効」= 永続化が確定した状態。
// timeout しても呼び出し側の判定は止めん（D1 barrier と judge が不足を検出する）。
const waitForPersistSettled = async (page: Page, timeoutMs: number): Promise<boolean> => {
  try {
    await page.waitForFunction(
      `(() => {
        const input = document.querySelector('textarea[aria-label$="へのメッセージ入力"]');
        return Boolean(input) && !input.disabled;
      })()`,
      // waitForFunction は (pageFunction, arg, options) を取る。arg を省いて渡すと
      // options が arg 扱いになり timeout が既定値のまま無視される。
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    console.warn("[scenario] input did not re-enable before timeout; persistence may be pending");
    return false;
  }
};

const parseQualityGuardEvent = (msg: ConsoleMessage): QualityGuardEvent | null => {
  if (msg.type() !== "info") return null;
  const text = msg.text();
  if (!text.includes("[quality-guard]")) return null;

  const attemptMatch = text.match(/attempt=(\d+)/);
  const passedMatch = text.match(/passed=(true|false)/);
  const failedMatch = text.match(/failed=(\S+)/);
  const attempt = attemptMatch ? Number(attemptMatch[1]) : 0;
  const passed = passedMatch ? passedMatch[1] === "true" : false;
  const failedCheck = failedMatch && failedMatch[1] !== "none" ? failedMatch[1] : null;

  return {
    attempt,
    passed,
    failedCheck,
    message: text,
    ts: Date.now(),
  };
};

const toChatResponseEvent = (response: Response): ChatResponseEvent | null => {
  if (!response.url().includes("/api/chat")) return null;
  const usedModel = response.headers()["x-model-used"] ?? null;
  const scenePhaseHeader = response.headers()["x-scene-phase"] ?? null;
  const scenePhase = isPhase(scenePhaseHeader) ? scenePhaseHeader : null;
  return {
    usedModel,
    scenePhase,
    ts: Date.now(),
  };
};

const buildTurnFailure = (
  turnIndex: number,
  userMsg: string,
  isCreampie: boolean | undefined,
  expectedPhase: Phase,
  screenshotPath: string,
  detail: string,
  failureCategory: FailureCategory,
  renderedMessageCount: number,
  persistedMessageCount: number,
  // 0 を入れると集計側で「0msで終わった正常ターン」として p95 に混ざる。
  // 落ちるまでに実際に待った時間をそのまま残す。
  wallClockMs: number,
): TurnResult => ({
  turnIndex,
  userMsg,
  isCreampie,
  assistantMsg: "",
  expectedPhase,
  detectedPhase: null,
  phaseMonotonicViolation: false,
  usedModel: null,
  qualityRetries: 0,
  failedCheck: null,
  renderedMessageCount,
  persistedMessageCount,
  firstTokenMs: null,
  lastChunkMs: null,
  hasDoneSignal: false,
  screenshotPath,
  wallClockMs,
  failureCategory,
  failureDetail: detail,
});

const takeTurnScreenshot = async (
  page: Page,
  runDir: string,
  scenarioId: ScenarioId,
  turnIndex: number,
): Promise<string> => {
  const screenshotPath = path.join(
    getScenarioDir(runDir, scenarioId),
    `turn-${formatTurn(turnIndex)}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
};

const captureImageResult = async (
  page: Page,
  env: E2eEnv,
  runDir: string,
  scenarioId: ScenarioId,
  conversationId: string,
  turnIndex: number,
): Promise<{
  novitaUrlReceived: boolean;
  r2KeyPersisted: boolean;
  reloadDisplayed: boolean;
  contentType: string;
  naturalWidth: number;
  novitaUrl: string | null;
  r2Url: string | null;
  novitaPath: string | null;
  r2ReloadPath: string | null;
  judgeVerdicts: Pick<JudgeVerdictSet, "r2" | "reload">;
}> => {
  await ensureDir(getScenarioImagesDir(runDir, scenarioId));

  const screenshotBeforeReloadPath = path.join(
    getScenarioImagesDir(runDir, scenarioId),
    `T${formatTurn(turnIndex)}-novita.png`,
  );
  const screenshotAfterReloadPath = path.join(
    getScenarioImagesDir(runDir, scenarioId),
    `T${formatTurn(turnIndex)}-r2-reload.png`,
  );
  const probeResult = await probeR2Stages(page, {
    conversationId,
    env,
    imgSelector: IMAGE_SELECTOR,
    domReadySelector: INPUT_SELECTOR,
    screenshotBeforeReloadPath,
    screenshotAfterReloadPath,
  });
  const judgeVerdicts = await runR2PersistenceJudge(page, probeResult);

  return {
    novitaUrlReceived: probeResult.novitaUrlReceived,
    r2KeyPersisted: probeResult.r2KeyPersisted,
    reloadDisplayed: probeResult.reloadDisplayed,
    contentType: probeResult.contentType,
    naturalWidth: probeResult.naturalWidth,
    novitaUrl: probeResult.novitaUrl,
    r2Url: probeResult.r2Url,
    novitaPath: probeResult.screenshotBeforeReload,
    r2ReloadPath: probeResult.screenshotAfterReload,
    judgeVerdicts,
  };
};

const aggregateJudgeVerdict = (
  verdicts: Array<JudgeVerdict | null | undefined>,
): JudgeVerdict | null => {
  const present = verdicts.filter(
    (verdict): verdict is JudgeVerdict => verdict !== null && verdict !== undefined,
  );
  if (present.length === 0) return null;

  const failure = present.find((verdict) => !verdict.pass);
  if (failure) {
    return {
      pass: false,
      reason: failure.reason,
    };
  }

  return {
    pass: true,
    reason: `${present.length}/${present.length} checks passed`,
  };
};

const aggregateScenarioJudgeVerdicts = (scenario: ScenarioResult): JudgeVerdictSet => ({
  ui: aggregateJudgeVerdict(scenario.turns.map((turn) => turn.judgeVerdicts?.ui)),
  d1: aggregateJudgeVerdict(scenario.turns.map((turn) => turn.judgeVerdicts?.d1)),
  r2: aggregateJudgeVerdict(scenario.turns.map((turn) => turn.judgeVerdicts?.r2)),
  reload: aggregateJudgeVerdict(scenario.turns.map((turn) => turn.judgeVerdicts?.reload)),
});

const scenarioDeadlineRemaining = (startedAtMs: number): number =>
  SCENARIO_TIMEOUT_MS - (Date.now() - startedAtMs);

const shouldFailFast = (
  def: ScenarioDefinition,
  turn: number,
  failureCategory: FailureCategory,
): boolean => (def.onFailFast ? def.onFailFast(turn, failureCategory) : false);

const installStrictQualityMode = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ({ key }) => {
      (
        globalThis as {
          localStorage: {
            setItem: (storageKey: string, storageValue: string) => void;
          };
        }
      ).localStorage.setItem(key, "1");
    },
    { key: E2E_STRICT_QUALITY_STORAGE_KEY },
  );
};

export async function runScenario(
  browser: Browser,
  env: E2eEnv,
  def: ScenarioDefinition,
  runDir: string,
): Promise<ScenarioResult> {
  const queue = getQueue(def.scenarioId);

  return queue.enqueue(async () => {
    const scenarioDir = getScenarioDir(runDir, def.scenarioId);
    const imagesDir = getScenarioImagesDir(runDir, def.scenarioId);
    await ensureDir(scenarioDir);
    await ensureDir(imagesDir);

    const startedAtIso = new Date().toISOString();
    const startedAtMs = Date.now();
    const qualityEvents: QualityGuardEvent[] = [];
    const chatResponses: ChatResponseEvent[] = [];
    let previousDetectedPhase: Phase | null = null;
    const recentDetectedPhases: Phase[] = [];
    let consecutiveFinalQualityFailTurns = 0;
    let page: Page | null = null;
    let context: Awaited<ReturnType<typeof createContext>> | null = null;

    let scenario: ScenarioResult = {
      scenarioId: def.scenarioId,
      conversationId: "pending",
      characterSlug: def.characterSlug,
      startedAt: startedAtIso,
      completedAt: null,
      status: "setup_failure",
      terminationReason: null,
      turns: [],
      imageResults: [],
      rubric: null,
      provisional: true,
      failureCategory: null,
    };

    try {
      context = await createContext(browser);
      page = await context.newPage();
      page.setDefaultTimeout(90_000);
      await installStrictQualityMode(page);
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error(`[browser-console][${def.scenarioId}] ${msg.type()}: ${msg.text()}`);
        }
        const parsed = parseQualityGuardEvent(msg);
        if (parsed) qualityEvents.push(parsed);
      });
      page.on("response", (response) => {
        const parsed = toChatResponseEvent(response);
        if (parsed) chatResponses.push(parsed);
        // 画像生成失敗の診断: /api/image 系の非 2xx レスポンスはボディ込みでログする。
        // /api/image/r2/* は本番データ由来の存在しないキーで 500 が大量発生するため除外。
        const url = response.url();
        if (
          url.includes("/api/image") &&
          !url.includes("/api/image/r2/") &&
          response.status() >= 400
        ) {
          void response
            .text()
            .then((body) => {
              console.error(
                `[${def.scenarioId}] /api/image error: ${response.request().method()} ${url} -> ${response.status()} body=${body.slice(0, 300)}`,
              );
            })
            .catch(() => undefined);
        }
      });

      const setup = await setupFreshConversation(
        page,
        env,
        def.scenarioId,
        def.characterSlug,
        env.userEmail,
      );
      scenario = {
        ...scenario,
        conversationId: setup.conversationId,
        // 会話を作っただけでは完了やない（#944）
        status: "running",
      };
      await writeScenarioSnapshot(runDir, scenario);
      let activeCharacterSlug = def.characterSlug;
      let currentConversationId = setup.conversationId;
      let greetingMessageCount = await readRenderedMessageCount(page);

      // headless fallback 時にグリーティングが streaming 中のまま turn-1 が開始されると
      // send button が disabled のまま turn timer (300s) を消費してタイムアウトする。
      // waitForFreshConversationState は 0 件安定で即 return するため
      // グリーティング開始前に enabled を拾って誤 return するリスクがある。
      // → send button が enabled かつ「受信中」プレースホルダーが存在しない状態を待つ。
      await page
        .waitForFunction(
          `(() => {
            // 送信ボタンは disabled={isLoading || !hasText} のため未入力時は常に無効。
            // 「入力可能=グリーティング streaming 完了」の指標には textarea(disabled=isLoading)を使う。
            const input = document.querySelector('textarea[aria-label$="へのメッセージ入力"]');
            if (!input || input.disabled) return false;
            const bubbles = Array.from(document.querySelectorAll('[data-testid="message-bubble"]'));
            const hasLoading = bubbles.some(b => /受信中|ことばを探している/.test(b.textContent || ''));
            return !hasLoading;
          })()`,
          { timeout: 600_000 },
        )
        .catch((e: unknown) => {
          console.error(
            `[greeting] waitForFunction timed out: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
      for (const turn of def.turns) {
        if (turn.characterSlug && turn.characterSlug !== activeCharacterSlug) {
          const switchedSetup = await setupFreshConversation(
            page,
            env,
            def.scenarioId,
            turn.characterSlug,
            env.userEmail,
          );
          activeCharacterSlug = turn.characterSlug;
          currentConversationId = switchedSetup.conversationId;
          greetingMessageCount = await readRenderedMessageCount(page);
          previousDetectedPhase = null;
          recentDetectedPhases.length = 0;
          scenario = {
            ...scenario,
            conversationId: currentConversationId,
          };
          await writeScenarioSnapshot(runDir, scenario);
        }

        const conversationId = currentConversationId;
        const hb = await heartbeat(browser);
        if (!hb) {
          scenario = {
            ...scenario,
            status: "aborted",
            completedAt: new Date().toISOString(),
            terminationReason: "browser heartbeat failed",
            failureCategory: "test.flaky",
          };
          await writeScenarioSnapshot(runDir, scenario);
          return scenario;
        }

        const remainingScenarioMs = scenarioDeadlineRemaining(startedAtMs);
        if (remainingScenarioMs <= 0) {
          scenario = {
            ...scenario,
            status: "aborted",
            completedAt: new Date().toISOString(),
            terminationReason: "scenario_timeout",
            failureCategory: "test.flaky",
          };
          await writeScenarioSnapshot(runDir, scenario);
          return scenario;
        }

        const turnTimeoutMs = Math.min(TURN_TIMEOUT_MS, remainingScenarioMs);
        const turnStartedAt = Date.now();
        const qualityStart = qualityEvents.length;
        const responseStart = chatResponses.length;
        const baselineMessageCount = await readRenderedMessageCount(page);
        const screenshotFallbackPath = path.join(
          scenarioDir,
          `turn-${formatTurn(turn.turnIndex)}.png`,
        );

        // 送信クリックの時刻。waitForStreamComplete がこのターンの /api/chat 要求だけを
        // 見るようにするための基準（前ターンの完了信号での誤解決を防ぐ）。
        let sendIssuedAt = turnStartedAt;
        // click 直前に観測した吹き出し数。前ターンのロールバックで数が減っていると
        // 入場時の baseline は到達不能になるため、UI 判定もこちらを基準にする。
        let renderedBeforeSend = baselineMessageCount;

        // ターンに残された時間が送信フェーズの総和より短いとき、外側の上限だけを
        // Math.min で切ると、内側の待ちが終わる前に外側が発火して composer_locked /
        // composer_missing が "turn-N-send timed out" に潰れる（#993 の本体）。
        // 内側を同じ比率で縮めて、短い残り時間でも内側が先に落ちて原因を出せるようにする。
        const sendPhase = fitSendPhaseToRemaining(
          turnTimeoutMs,
          DEFAULT_SEND_TURN_BUDGET,
          SEND_PHASE_MARGIN_MS,
        );
        // 送信後の echo settle も余白の一部。縮めずに置くと、縮んだ上限を単独で
        // 食い潰して外側が先に発火する。
        const sendEchoSettleMs = Math.max(1, Math.floor(SEND_ECHO_SETTLE_MS * sendPhase.factor));

        try {
          await withTimeout(
            (async () => {
              await ensureStreamProbe(page);
              // 自動生成画像の到着でフルスクリーンビューア（写真到着演出）が開くと
              // composer が覆われ send button が見つからないまま turn timeout する
              // （実証: run-20260711-223711 turn-03.png）。実ユーザー同様タップで閉じる。
              //
              // autoGenerateImages はほぼ毎ターン発火しうるため、ビューアが閉じるより速く
              // 次のビューアが開くことがある。ボタンクリックは閉じるビューア自身の DOM 上に
              // あるボタンを毎回 hit-test するため、次のビューアの別要素に負けて intercept
              // されうる（実証: gate899 2026-07-28 run、S4 turn4 で毎回同じ箇所停止）。
              // Escape はどの要素が最前面かに関係なく window の keydown で拾われるため
              // （OuPhotoOverlay の useEscapeToClose）、まずこちらを打つ。
              const overlayPage = page;
              const dismissPhotoOverlay = async (): Promise<void> => {
                if (!overlayPage) return;
                await overlayPage.keyboard.press("Escape").catch(() => undefined);
                const closeBtn = overlayPage.locator('button[aria-label="写真を閉じる"]').first();
                await closeBtn.click({ timeout: 500 }).catch(() => undefined);
              };
              await dismissPhotoOverlay();
              const input = page.locator(INPUT_SELECTOR);
              // #993: 旧実装は「enabled をポーリング → 別ステップで force click」だったため、
              // 判定とクリックの隙間で isLoading が true へ戻ると handleSend が即 return し、
              // user message が DOM に入らないまま 300 秒黙って止まっていた。
              // 判定と click を同一タスクで行い、送信後は DOM への反映まで確認する。
              // page は let で宣言されており、コールバック内では非 null 絞り込みが効かない。
              const composerPage = page;
              const outcome = await sendTurnMessage(
                {
                  readComposerState: () => readComposerState(composerPage),
                  dismissPhotoOverlay,
                  // dismiss と fill の間に次の画像到着でビューアが再度開くレースがあるため、
                  // 短い fill を閉じ直しながらリトライする（実証: run-20260711-230352 turn-11）。
                  // timeout は固定 5 秒やのうて sendPhase.budget.fillMs を使う。固定のままだと、
                  // 残り時間が5秒未満へ縮んだ終盤ターンで、この fill だけが外側の
                  // turn-N-send timed out より先に潰れず、fill_failed という固有コードが
                  // 一般的なタイムアウトに丸められる。
                  fillInput: (text) => input.fill(text, { timeout: sendPhase.budget.fillMs }),
                  clickSendIfEnabled: () => clickSendIfEnabled(composerPage),
                  now: () => Date.now(),
                  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
                },
                {
                  turnIndex: turn.turnIndex,
                  text: turn.userMsg,
                  baselineMessageCount: baselineMessageCount,
                  budget: sendPhase.budget,
                },
              );
              sendIssuedAt = outcome.sendIssuedAt;
              renderedBeforeSend = outcome.renderedBeforeSend;
              if (outcome.attempts > 1) {
                console.warn(
                  `[${def.scenarioId}] turn ${turn.turnIndex}: send required ${outcome.attempts} attempts`,
                );
              }
              // 期待値は click 直前に観測した数から組み直す。ターン入場時の baseline は、
              // 前ターンのロールバックで吹き出しが減っていると到達不能になる。
              // assistant プレースホルダーの描画までは短い専用予算で待つ。
              // ここでターン全体の予算を渡すと、原因が外側の turn_timeout へ丸められる。
              await waitForMessageCount(page, renderedBeforeSend + 2, sendEchoSettleMs);
            })(),
            sendPhase.timeoutMs,
            `turn-${turn.turnIndex}-send`,
          );

          const streamStats = await withTimeout(
            waitForStreamComplete(page, turnTimeoutMs, sendIssuedAt),
            turnTimeoutMs,
            `turn-${turn.turnIndex}-stream`,
          );

          // waitForStreamComplete が done chunk 検出後に即 return した場合、
          // React の再レンダリングが未完了で「受信中」プレースホルダーが残る。
          // 最大 15s 待って実テキストが描画されるのを確認してから読む。
          await page
            .waitForFunction(
              `(() => {
              const groups = Array.from(document.querySelectorAll('[data-testid="message-bubble"]'));
              const last = groups.filter(g =>
                !g.classList.contains('justify-end') &&
                !g.classList.contains('bg-gradient-user-bubble') &&
                !g.classList.contains('flex-row-reverse')
              ).at(-1);
              if (!last) return false;
              const text = last.textContent?.trim() ?? '';
              return text.length > 0 && !/受信中|ことばを探している/.test(text);
            })()`,
              { timeout: 15_000 },
            )
            .catch(() => {
              // タイムアウトは非致命的 — テキストが取れなかった場合はそのまま読む
            });

          const assistantMsg = await readAssistantText(page);
          // 空レスポンス検出: firstTokenMs=null かつ assistantMsg="" の場合、
          // 再試行ボタンが出ているはずなのでクリックして 1 回だけリトライする。
          // OpenRouter が一時的に空レスポンスを返したときのユーザー操作をシミュレートする。
          let effectiveStreamStats = streamStats;
          let effectiveAssistantMsg = assistantMsg;
          const degradedFailures: TurnFailure[] = [];
          // firstTokenMs が null でなくても (probe が制御イベントを拾った場合など)
          // テキストが空または「受信中」プレースホルダーのままなら空レスポンスと見なしてリトライする。
          const isEmptyOrPlaceholder = (msg: string): boolean =>
            msg.trim() === "" || msg.trim() === "受信中" || msg.includes("ことばを探している");
          if (isEmptyOrPlaceholder(effectiveAssistantMsg)) {
            // 複数ターンが連続で空レスポンスになると再試行ボタンが複数出る。
            // strict mode violation を避けるため .last() で最新のものだけクリックする。
            const retryBtn = page.locator(RETRY_BUTTON_SELECTOR);
            if ((await retryBtn.count()) > 0) {
              const retryEnabled = await waitForLatestRetryButtonEnabled(page);
              if (!retryEnabled) {
                const message =
                  "retry button remained disabled after empty assistant response; degraded and continuing";
                console.warn(`[${def.scenarioId}] turn ${turn.turnIndex}: ${message}`);
                degradedFailures.push({
                  code: "retry_button_disabled",
                  message,
                  retryable: true,
                });
              } else {
                try {
                  const retryIssuedAt = Date.now();
                  await retryBtn.last().click({ timeout: 5_000 });
                  const retryStats = await withTimeout(
                    waitForStreamComplete(page, turnTimeoutMs, retryIssuedAt),
                    turnTimeoutMs,
                    `turn-${turn.turnIndex}-retry-stream`,
                  );
                  effectiveAssistantMsg = await readAssistantText(page);
                  effectiveStreamStats = retryStats;
                  if (isEmptyOrPlaceholder(effectiveAssistantMsg)) {
                    // retry も空: API 回復を待つため少し待機してから次ターンに進む
                    await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
                  }
                } catch (retryError) {
                  const message = `retry interaction failed after empty assistant response: ${toFailureDetail(retryError)}`;
                  console.warn(`[${def.scenarioId}] turn ${turn.turnIndex}: ${message}`);
                  degradedFailures.push({
                    code: "retry_interaction_failed",
                    message,
                    retryable: true,
                  });
                }
              }
            }
          }
          const renderedMessageCount = await readRenderedMessageCount(page);
          // waitForStreamComplete は SSE の [DONE] を見た時点で返るが、アプリはそこから
          // persistCompletedTurn を await してから loading を落とす。[DONE] 直後に D1 を
          // 数えると書き込み前を読むため、8 秒 barrier が毎ターン timeout し、判定が恒常的に
          // 1 ターン分不足しとった（最終ターンは実行終了に間に合わず未永続のまま消えた）。
          await waitForPersistSettled(
            page,
            Math.max(0, Math.min(PERSIST_SETTLE_WAIT_MS, scenarioDeadlineRemaining(startedAtMs))),
          );
          // グリーティングは会話作成時に D1 へ挿入される場合があり、その行はターン開始前から
          // 在る。描画ぶんを一律で引くと barrier の期待値が 1 件低くなり、今ターンの
          // assistant 行が未永続のまま settled と判定されてしまう。
          const preTurnPersistedMessages = await listPersistedMessages(
            page,
            env,
            conversationId,
          ).catch((err: unknown) => {
            console.warn("[scenario] pre-turn listPersistedMessages failed (non-fatal)", err);
            return [] as PersistedMessage[];
          });
          const persistedGreetingCount = countPersistedGreetings(
            conversationId,
            preTurnPersistedMessages,
          );
          const expectedPersistedCount = computeExpectedPersistedCount({
            renderedMessageCount,
            greetingMessageCount,
            persistedGreetingCount,
          });
          // streaming 後 assistant row 永続化までの race を barrier で吸収 (v2 P0d)
          // wrangler d1 execute CLI は SQLITE_BUSY 競合を起こすため HTTP API 版を使う
          const pageForD1 = page;
          const d1Barrier = await waitForD1Durability({
            userEmail: env.userEmail,
            conversationId,
            expectedCount: expectedPersistedCount,
            timeoutMs: 8_000,
            fetchCountFn: async (id) => {
              const messages = await listPersistedMessages(pageForD1, env, id);
              return messages.length;
            },
          });
          const screenshotPath = await takeTurnScreenshot(
            page,
            runDir,
            def.scenarioId,
            turn.turnIndex,
          );
          const persistedMessages = await listPersistedMessages(page, env, conversationId).catch(
            (err: unknown) => {
              console.warn("[scenario] listPersistedMessages failed (non-fatal)", err);
              return [] as PersistedMessage[];
            },
          );
          const imageMessageCount = countPersistedImageMessages(persistedMessages);
          const phaseJudgment = await judgePhaseWithLlm({
            assistantMsg: effectiveAssistantMsg,
            expectedPhase: turn.expectedPhase,
            previousDetected: previousDetectedPhase,
            recentDetected: recentDetectedPhases,
            // D1取得(listPersistedMessages)が失敗すると persistedMessages が空配列になり、
            // 分類器に文脈が渡らず常にescalate:false化する。取得失敗時は現在ターンの
            // メモリ上のメッセージだけでも渡す。
            // classifySubtextEscalation内部のcollectRecentTurnsもsystemを除外して
            // 直近6件にスライスするため、ここで先にsystemを除外してからスライスしないと
            // systemメッセージが混入した分だけ実際の会話ターン数が6未満になる
            // (2026-07-16 Devin指摘)。
            // waitForD1Durability がタイムアウトした場合でも greeting 等の既存行だけで
            // persistedMessages.length > 0 は満たされてしまい、今ターンの発話が
            // 未反映のまま古い履歴を分類器に渡してしまう。expectedPersistedCount
            // (今ターンまでの想定行数)に達しているかも合わせて確認する
            // (2026-07-16 Codex connector 指摘)。
            // 再生成経路では既存 assistant 行の UPDATE を await する前に loading が落ちるため、
            // 行数が揃っていても中身が空のまま残る。行数と内容の両方を見る
            // (2026-07-27 Codex connector 指摘)。
            recentTurnsForClassifier: selectRecentTurnsForClassifier({
              persistedMessages,
              expectedPersistedCount,
              renderedUserMsg: turn.userMsg,
              renderedAssistantMsg: effectiveAssistantMsg,
            }),
          });
          const detectedPhase = phaseJudgment.detected;
          const phaseMonotonicViolation = phaseJudgment.monotonicViolation;
          previousDetectedPhase = detectedPhase;
          recentDetectedPhases.push(detectedPhase);
          if (recentDetectedPhases.length > RECENT_PHASE_WINDOW_TURNS) recentDetectedPhases.shift();

          const turnQualityEvents = qualityEvents.slice(qualityStart);
          const turnResponses = chatResponses.slice(responseStart);
          const qualityRetries = turnQualityEvents.reduce(
            (max, event) => Math.max(max, event.attempt),
            0,
          );
          const finalQualityEvent = turnQualityEvents.at(-1) ?? null;
          const failedCheck =
            finalQualityEvent && !finalQualityEvent.passed ? finalQualityEvent.failedCheck : null;
          // ヘッダは1トークン目のモデルで固定される。作り直しでモデルが替わった時に
          // 実際に採用された本文のモデルを載せるため、quality-meta を優先する。
          const usedModel =
            effectiveStreamStats.servedModel ?? turnResponses.at(-1)?.usedModel ?? null;
          const serverPhase = turnResponses.at(-1)?.scenePhase ?? null;
          const uiJudgeVerdict = runUISuccessJudge({
            renderedMessageCount,
            previousCount: renderedBeforeSend,
            hasDoneSignal: effectiveStreamStats.hasDoneSignal,
            firstTokenMs: effectiveStreamStats.firstTokenMs,
          });
          const d1JudgeVerdict = await runD1PersistenceJudge({
            conversationId,
            renderedMessageCount,
            greetingMessageCount,
            imageMessageCount,
            persistedCount: persistedMessages.length,
            persistedMessages,
            uiReason: uiJudgeVerdict.reason,
          });

          let turnResult: TurnResult = {
            turnIndex: turn.turnIndex,
            userMsg: turn.userMsg,
            assistantMsg: effectiveAssistantMsg,
            isCreampie: turn.isCreampie,
            isSubtextProbe: turn.isSubtextProbe,
            expectedPhase: turn.expectedPhase,
            phase: serverPhase,
            detectedPhase,
            phaseMonotonicViolation,
            usedModel,
            qualityRetries,
            failedCheck,
            renderedMessageCount,
            persistedMessageCount: persistedMessages.length,
            d1BarrierSettled: d1Barrier.settled,
            d1BarrierElapsedMs: d1Barrier.elapsedMs,
            d1BarrierLastCount: d1Barrier.lastCount,
            d1BarrierTimeout: d1Barrier.settled ? undefined : true,
            firstTokenMs: effectiveStreamStats.firstTokenMs,
            lastChunkMs: effectiveStreamStats.lastChunkMs,
            hasDoneSignal: effectiveStreamStats.hasDoneSignal,
            regeneratedCount: effectiveStreamStats.regeneratedCount,
            screenshotPath,
            wallClockMs: Date.now() - turnStartedAt,
            failureCategory: failedCheck
              ? classifyFailure({ message: failedCheck, context: "quality-guard" })
              : null,
            failureDetail: failedCheck,
            failures: degradedFailures,
            judgeVerdicts: {
              ui: uiJudgeVerdict,
              d1: d1JudgeVerdict,
              r2: null,
              reload: null,
            },
          };

          scenario = appendTurn(scenario, turnResult);

          if (turn.isImageTrigger) {
            let imageCapturePromise: Promise<
              Awaited<ReturnType<typeof captureImageResult>>
            > | null = null;
            try {
              // 初回 Novita URL の短い露出を取りこぼさないよう、probe を先に起動してから発火する。
              imageCapturePromise = captureImageResult(
                page,
                env,
                runDir,
                def.scenarioId,
                conversationId,
                turn.turnIndex,
              );
              await page.locator('button[title="画像生成"]').click({ timeout: 10_000 });
              // 「画像」ボタンの短押しは課金確認ダイアログ(InputBar.handleCameraPointerUp)を
              // 開くだけで、実際の生成は別の「生成する」ボタン(handleImageGenerateConfirm)を
              // 押すまで発火しない。ここを押さないと captureImageResult は来ないリクエストを
              // 待ち続けてタイムアウトする(#1000 レビュー指摘)。
              await page.getByRole("button", { name: "生成する" }).click({ timeout: 10_000 });
              const image = await withTimeout(
                imageCapturePromise,
                turnTimeoutMs,
                `turn-${turn.turnIndex}-image`,
              );
              scenario = appendImage(scenario, {
                turnIndex: turn.turnIndex,
                novitaUrlReceived: image.novitaUrlReceived,
                r2KeyPersisted: image.r2KeyPersisted,
                reloadDisplayed: image.reloadDisplayed,
                contentType: image.contentType,
                naturalWidth: image.naturalWidth,
                novitaUrl: image.novitaUrl,
                r2Url: image.r2Url,
                novitaPath: image.novitaPath,
                r2ReloadPath: image.r2ReloadPath,
                reviewerSignature: null,
                reviewerNotes: null,
              });
              turnResult = {
                ...turnResult,
                judgeVerdicts: {
                  ...(turnResult.judgeVerdicts ?? {
                    ui: null,
                    d1: null,
                    r2: null,
                    reload: null,
                  }),
                  r2: image.judgeVerdicts.r2,
                  reload: image.judgeVerdicts.reload,
                },
              };
              scenario = appendTurn(scenario, turnResult);
            } catch (imageError) {
              // 画像プローブ失敗はシナリオ abort に昇格させず縮退する。
              // abort すると以降の climax/afterglow ターンが全て失われ、
              // image bonus -15 どころかシナリオ全体のスコアが崩壊するため。
              void imageCapturePromise?.catch(() => undefined);
              const message = imageError instanceof Error ? imageError.message : String(imageError);
              console.error(
                `[${def.scenarioId}] image probe failed at turn ${turn.turnIndex} (degraded, continuing): ${message}`,
              );
              const degradedImage = {
                turnIndex: turn.turnIndex,
                novitaUrlReceived: false,
                r2KeyPersisted: false,
                reloadDisplayed: false,
                contentType: "",
                naturalWidth: 0,
                novitaUrl: null,
                r2Url: null,
                novitaPath: null,
                r2ReloadPath: null,
                reviewerSignature: null,
                reviewerNotes: null,
                failureDetail: message,
              };
              scenario = appendImage(scenario, degradedImage);
              scenario = appendTurn(scenario, turnResult);
            }
          }

          scenario = {
            ...scenario,
            judgeVerdicts: aggregateScenarioJudgeVerdicts(scenario),
          };

          await writeScenarioSnapshot(runDir, scenario);

          if (failedCheck) {
            consecutiveFinalQualityFailTurns += 1;
            const failureCategory =
              turnResult.failureCategory ??
              classifyFailure({
                message: `quality guard failed:${failedCheck}`,
                context: "quality-guard",
              });
            if (consecutiveFinalQualityFailTurns < MAX_STRICT_QUALITY_FINAL_FAIL_TURNS) {
              await writeScenarioSnapshot(runDir, scenario);
            } else {
              scenario = {
                ...scenario,
                status: "failed",
                completedAt: new Date().toISOString(),
                terminationReason: `quality guard final-fail threshold reached:${consecutiveFinalQualityFailTurns}/${MAX_STRICT_QUALITY_FINAL_FAIL_TURNS} last=${failedCheck}`,
                failureCategory,
              };
              await writeScenarioSnapshot(runDir, scenario);
              return scenario;
            }
          } else {
            consecutiveFinalQualityFailTurns = 0;
          }

          if (phaseMonotonicViolation) {
            const failureCategory: FailureCategory = "test.flaky";
            if (shouldFailFast(def, turn.turnIndex, failureCategory)) {
              turnResult = {
                ...turnResult,
                failureCategory,
                failureDetail: "phase monotonic regression",
              };
              scenario = appendTurn(scenario, turnResult);
              scenario = {
                ...scenario,
                status: "fail_fast",
                completedAt: new Date().toISOString(),
                terminationReason: "phase_monotonic_violation",
                failureCategory,
              };
              await writeScenarioSnapshot(runDir, scenario);
              return scenario;
            }
          }
        } catch (error) {
          // 失敗した瞬間の時刻をここで採る。この下でスクショ・D1問い合わせ・DOM計数を
          // 待つため、後から測るとその診断時間まで応答時間として遅延ゲートに乗る。
          const failedAt = Date.now();
          const detail = toFailureDetail(error);
          const turnQualityEvents = qualityEvents.slice(qualityStart);
          const finalQualityEvent = turnQualityEvents.at(-1) ?? null;
          const strictQualityFailed =
            finalQualityEvent !== null &&
            !finalQualityEvent.passed &&
            finalQualityEvent.failedCheck !== null;
          const strictFailedCheck = strictQualityFailed ? finalQualityEvent.failedCheck : null;
          const failureDetail = strictQualityFailed
            ? `quality guard failed:${strictFailedCheck}`
            : detail;
          const failureCategory = classifyFailure({
            message: failureDetail,
            context: strictQualityFailed ? "quality-guard" : "browser",
          });
          const screenshotPath = await takeTurnScreenshot(
            page,
            runDir,
            def.scenarioId,
            turn.turnIndex,
          ).catch(async () => screenshotFallbackPath);
          const persistedMessageCount = await listPersistedMessages(page, env, conversationId)
            .then((messages) => messages.length)
            .catch(() => 0);
          const renderedMessageCount = await readRenderedMessageCount(page).catch(() => 0);
          const qualityRetries = turnQualityEvents.reduce(
            (max, event) => Math.max(max, event.attempt),
            0,
          );
          let turnResult = buildTurnFailure(
            turn.turnIndex,
            turn.userMsg,
            turn.isCreampie,
            turn.expectedPhase,
            screenshotPath,
            failureDetail,
            failureCategory,
            renderedMessageCount,
            persistedMessageCount,
            failedAt - turnStartedAt,
          );
          if (strictFailedCheck) {
            turnResult = {
              ...turnResult,
              qualityRetries,
              failedCheck: strictFailedCheck,
              failureDetail: strictFailedCheck,
            };
          }
          scenario = appendTurn(scenario, turnResult);
          if (strictFailedCheck) {
            consecutiveFinalQualityFailTurns += 1;
            if (consecutiveFinalQualityFailTurns < MAX_STRICT_QUALITY_FINAL_FAIL_TURNS) {
              await writeScenarioSnapshot(runDir, scenario);
              continue;
            }
          }
          scenario = {
            ...scenario,
            status: strictQualityFailed
              ? "failed"
              : shouldFailFast(def, turn.turnIndex, failureCategory)
                ? "fail_fast"
                : "aborted",
            completedAt: new Date().toISOString(),
            terminationReason: strictQualityFailed
              ? `quality guard final-fail threshold reached:${consecutiveFinalQualityFailTurns}/${MAX_STRICT_QUALITY_FINAL_FAIL_TURNS} last=${strictFailedCheck}`
              : detail.includes("timed out")
                ? "turn_timeout"
                : detail,
            failureCategory,
          };
          await writeScenarioSnapshot(runDir, scenario);
          return scenario;
        }
      }

      scenario = {
        ...scenario,
        status: "completed",
        completedAt: new Date().toISOString(),
        terminationReason: null,
        judgeVerdicts: aggregateScenarioJudgeVerdicts(scenario),
      };
      await writeScenarioSnapshot(runDir, scenario);
      return scenario;
    } catch (error) {
      const detail = toFailureDetail(error);
      scenario = {
        ...scenario,
        completedAt: new Date().toISOString(),
        status: "setup_failure",
        terminationReason: detail,
        failureCategory: classifyFailure({ message: detail, context: "preflight" }),
      };
      await writeScenarioSnapshot(runDir, scenario);
      return scenario;
    } finally {
      if (context) {
        await closeContext(context);
      }
    }
  });
}
