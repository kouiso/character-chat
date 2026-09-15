import { buildLocalAuthHeaders, installLocalApiAuth } from "./auth";
import { waitForDomReady } from "./browser-wait";

import type { E2eEnv } from "./env";
import type { ScenarioId } from "./types";
import type { Page } from "playwright";

export type ScenarioSetup = {
  scenarioId: ScenarioId;
  characterSlug: string;
  conversationId: string;
};

type CharacterRecord = {
  id: string;
  name: string;
};

const APP_READY_SELECTOR = '[data-testid="message-bubble"]';
const MESSAGE_GROUP_SELECTOR = '[data-testid="message-bubble"]';
const AGE_GATE_TITLE = "年齢確認";
const AGE_GATE_ACCEPT = "はい、18歳以上です";
const E2E_SETTINGS_STORAGE_KEY = "ai-chat-settings";
const AGE_VERIFICATION_STORAGE_KEY = "age_verified";
// src/lib/onboarding-state.ts の ONBOARDED_KEY と同値。オンボーディング overlay が
// 送信ボタンを覆い greeting 待ちがタイムアウトするため、実施済みとして注入する
const ONBOARDED_STORAGE_KEY = "ou_onboarded";
const DEFAULT_E2E_MODEL = "qwen/qwen-2.5-72b-instruct";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const parseCharacters = (value: unknown): CharacterRecord[] => {
  if (!isRecord(value) || !Array.isArray(value.characters)) {
    return [];
  }

  return value.characters.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = readString(entry.id);
    const name = readString(entry.name);
    return id && name ? [{ id, name }] : [];
  });
};

const parseConversationId = (value: unknown): string | null => {
  if (!isRecord(value) || !isRecord(value.conversation)) {
    return null;
  }
  return readString(value.conversation.id);
};

const normalizeToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "");

const isDefaultCharacterSlug = (characterSlug: string): boolean => {
  const normalized = normalizeToken(characterSlug);
  return (
    normalized === "" || normalized === "default" || normalized === "ai" || normalized === "sakura"
  );
};

const matchCharacter = (
  characters: CharacterRecord[],
  characterSlug: string,
): CharacterRecord | null => {
  const normalizedSlug = normalizeToken(characterSlug);
  for (const character of characters) {
    const candidates = [
      character.id,
      character.name,
      character.name.replace(/\s+/g, ""),
      character.name.replace(/\s+/g, "-"),
    ];
    if (candidates.some((candidate) => normalizeToken(candidate) === normalizedSlug)) {
      return character;
    }
  }
  return null;
};

const fetchCharacters = async (
  page: Page,
  env: E2eEnv,
  userEmail: string,
): Promise<CharacterRecord[]> => {
  const response = await page.context().request.get(`${env.devOrigin}/api/characters`, {
    failOnStatusCode: false,
    headers: buildLocalAuthHeaders(userEmail),
    timeout: 30_000,
  });
  if (!response.ok()) {
    throw new Error(`character list fetch failed: ${response.status()}`);
  }
  const payload: unknown = await response.json();
  return parseCharacters(payload);
};

const readRenderedMessages = async (
  page: Page,
): Promise<Array<{ role: "user" | "assistant"; text: string }>> =>
  Promise.all(
    Array.from({ length: await page.locator(MESSAGE_GROUP_SELECTOR).count() }, async (_, index) => {
      const group = page.locator(MESSAGE_GROUP_SELECTOR).nth(index);
      const className = (await group.getAttribute("class")) ?? "";
      const text = (await group.textContent())?.trim() ?? "";
      const role = className.includes("flex-row-reverse") ? "user" : "assistant";
      return { role, text };
    }),
  );

const waitForFreshConversationState = async (page: Page): Promise<void> => {
  const startedAt = Date.now();
  // キャラクターグリーティングは characterGreeting フィールドから即時追加されるが、
  // 会話データの API フェッチ完了まで数百ms 遅延する場合がある。
  // 0 件を即座に返すと greetingMessageCount=0 のまま固定されて D1 期待値がズレるため、
  // 2 秒間安定して 0 件であることを確認してから「グリーティングなし」と判断する。
  const EMPTY_STABILIZE_MS = 2_000;
  let emptyFirstSeenAt: number | null = null;
  while (Date.now() - startedAt <= 30_000) {
    const messages = await readRenderedMessages(page);
    if (messages.length === 0) {
      if (emptyFirstSeenAt === null) emptyFirstSeenAt = Date.now();
      if (Date.now() - emptyFirstSeenAt >= EMPTY_STABILIZE_MS) return;
    } else if (messages.length === 1 && messages[0]?.role === "assistant") {
      // 仕様上、作成直後の自動グリーティング 1 件までは許容する。
      return;
    } else {
      emptyFirstSeenAt = null;
    }
    await sleep(100);
  }
  throw new Error("fresh conversation did not settle to 0 or 1 greeting message");
};

const dismissAgeGateIfPresent = async (page: Page): Promise<void> => {
  const ageGate = page.getByRole("dialog", { name: AGE_GATE_TITLE });
  const isVisible = await ageGate.isVisible().catch(() => false);
  if (!isVisible) {
    return;
  }

  await page.getByRole("button", { name: AGE_GATE_ACCEPT, exact: true }).click();
  await ageGate.waitFor({ state: "hidden", timeout: 10_000 });
};

const seedE2eSettings = async (page: Page, activeCharacterId: string | null): Promise<void> => {
  const model = process.env.E2E_MODEL ?? DEFAULT_E2E_MODEL;
  const persisted = JSON.stringify({
    state: {
      model,
      nsfwBlur: false,
      darkMode: true,
      // autoGenerateImages はほぼ毎ターン写真到着の全画面ビューアを発火させる設計で、
      // 台本の連投にビューアを閉じる処理が追いつかず composer を覆ったまま送信が尽きる
      // (実証: gate899 2026-07-28 run)。isImageTrigger turn の画像生成ボタン押下は
      // この設定と無関係に動くため、ここを切っても測っている対象は変わらない。
      autoGenerateImages: false,
      autoExtractMemories: false,
      ttsEnabled: false,
      ttsVoiceUri: "",
      ttsRate: 1,
      ttsPitch: 1,
      activeCharacterId,
      userProfile: "",
      userRole: "",
      responseLength: "long",
      imageProvider: "novita",
    },
    version: 30,
  });

  const ageVerified = JSON.stringify({ verified: true, timestamp: Date.now() });

  await page.addInitScript(
    ({ settingsKey, settingsValue, ageKey, ageValue, onboardedKey }) => {
      globalThis.localStorage.setItem(settingsKey, settingsValue);
      globalThis.localStorage.setItem(ageKey, ageValue);
      globalThis.localStorage.setItem(onboardedKey, "1");
    },
    {
      settingsKey: E2E_SETTINGS_STORAGE_KEY,
      settingsValue: persisted,
      ageKey: AGE_VERIFICATION_STORAGE_KEY,
      ageValue: ageVerified,
      onboardedKey: ONBOARDED_STORAGE_KEY,
    },
  );
  await page
    .evaluate(
      ({ settingsKey, settingsValue, ageKey, ageValue, onboardedKey }) => {
        globalThis.localStorage.setItem(settingsKey, settingsValue);
        globalThis.localStorage.setItem(ageKey, ageValue);
        globalThis.localStorage.setItem(onboardedKey, "1");
      },
      {
        settingsKey: E2E_SETTINGS_STORAGE_KEY,
        settingsValue: persisted,
        ageKey: AGE_VERIFICATION_STORAGE_KEY,
        ageValue: ageVerified,
        onboardedKey: ONBOARDED_STORAGE_KEY,
      },
    )
    .catch(() => undefined);
};

const createConversationViaApi = async (
  page: Page,
  env: E2eEnv,
  userEmail: string,
  characterId: string | null,
): Promise<string> => {
  const response = await page.context().request.post(`${env.devOrigin}/api/conversations`, {
    failOnStatusCode: false,
    headers: {
      ...buildLocalAuthHeaders(userEmail),
      "Content-Type": "application/json",
    },
    data: characterId ? { characterId } : {},
    timeout: 30_000,
  });
  if (!response.ok()) {
    throw new Error(`conversation create failed: ${response.status()}`);
  }
  const payload: unknown = await response.json();
  const conversationId = parseConversationId(payload);
  if (!conversationId) {
    throw new Error("conversation id missing from create conversation response");
  }
  return conversationId;
};

const buildChatUrl = (origin: string, hashPath: string): string => {
  const url = new URL(origin);
  url.searchParams.set("e2e", String(Date.now()));
  url.searchParams.set("t", String(Date.now()));
  url.hash = hashPath;
  return url.toString();
};

const waitForConversationMessagesResponse = (
  page: Page,
  conversationId: string,
): Promise<unknown> =>
  page
    .waitForResponse(
      (response) =>
        response.url().includes(`/api/conversations/${conversationId}/messages`) &&
        response.status() < 500,
      { timeout: 30_000 },
    )
    .catch((error: unknown) => error);

const openDefaultConversation = async (
  page: Page,
  env: E2eEnv,
  conversationId: string,
): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const messagesResponse = waitForConversationMessagesResponse(page, conversationId);

    try {
      await page.goto(
        buildChatUrl(env.devOrigin, `/chat?conv=${encodeURIComponent(conversationId)}`),
        {
          waitUntil: "domcontentloaded",
        },
      );
      await dismissAgeGateIfPresent(page);
      await waitForDomReady(page, APP_READY_SELECTOR);
      await messagesResponse;
      await waitForFreshConversationState(page);
      return;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`created conversation did not appear in UI: ${conversationId}`);
};

export async function setupFreshConversation(
  page: Page,
  env: E2eEnv,
  scenarioId: ScenarioId,
  characterSlug: string,
  userEmail: string,
): Promise<ScenarioSetup> {
  await installLocalApiAuth(page, env.devOrigin, userEmail);

  const characters = await fetchCharacters(page, env, userEmail);
  const matchedCharacter = isDefaultCharacterSlug(characterSlug)
    ? null
    : matchCharacter(characters, characterSlug);
  if (!isDefaultCharacterSlug(characterSlug) && !matchedCharacter) {
    throw new Error(`character not found for slug: ${characterSlug}`);
  }

  // localhost でも最初の API リクエストから namespaced userEmail を渡して
  // D1 の conversation/message を run 単位で分離する。
  await seedE2eSettings(page, matchedCharacter?.id ?? null);
  const conversationId = await createConversationViaApi(
    page,
    env,
    userEmail,
    matchedCharacter?.id ?? null,
  );

  // キャラクター会話でも /chat ルートから sidebar click で開く。
  // /chat/char-X?conv= を使うと useRoutedCharacterConversation が会話リスト読み込み後に
  // 既存会話を上書き選択するレースコンディションが発生する。
  // /chat (routeCharacterId=null) では hook が即 return するため上書きが起きない。
  await openDefaultConversation(page, env, conversationId);

  return {
    scenarioId,
    characterSlug,
    conversationId,
  };
}
