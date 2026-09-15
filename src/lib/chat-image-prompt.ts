import { detectScenePhase, type ScenePhase } from "@/lib/scene-phase";
import type { ChatMessage } from "@/store/chat-store";

const DEFAULT_MAX_TURNS = 3;
const DEFAULT_MAX_LENGTH = 1200;
const LATEST_MARKER = "[最新]";

type MessagePair = { user?: string; assistant?: string };

const hasContent = (message: ChatMessage): boolean => message.content.trim().length > 0;

const buildFallbackPair = (reversedMessages: ChatMessage[]): MessagePair[] => {
  const lastUser = reversedMessages.find(
    (message) => message.role === "user" && hasContent(message),
  );
  const lastAssistant = reversedMessages.find(
    (message) => message.role === "assistant" && hasContent(message),
  );
  return [
    {
      user: lastUser?.content.slice(0, 400),
      assistant: lastAssistant?.content.slice(0, 400),
    },
  ];
};

const collectRecentMessagePairs = (messages: ChatMessage[], maxTurns: number): MessagePair[] => {
  const allPairs: MessagePair[] = [];

  for (const message of messages) {
    if (!hasContent(message)) continue;

    if (message.role === "user" && hasContent(message)) {
      allPairs.push({ user: message.content.slice(0, 400) });
      continue;
    }

    if (message.role === "assistant") {
      const latestPairIndex = allPairs.length - 1;
      const latestPair = allPairs[latestPairIndex];
      if (latestPair && latestPair.user && !latestPair.assistant) {
        allPairs[latestPairIndex] = {
          ...latestPair,
          assistant: message.content.slice(0, 400),
        };
      }
    }
  }

  const recentPairs = allPairs.slice(-maxTurns);
  return recentPairs.length > 0 ? recentPairs : buildFallbackPair([...messages].reverse());
};

const formatMessagePairsForPrompt = (pairs: MessagePair[]): string => {
  const historyLines = pairs.map((pair, index) => {
    const isLatest = index === pairs.length - 1;
    const prefix = isLatest ? LATEST_MARKER : `[${index + 1}ターン前]`;
    const parts: string[] = [];
    if (pair.user) parts.push(`${prefix} ユーザー: ${pair.user}`);
    if (pair.assistant) parts.push(`${prefix} キャラ: ${pair.assistant}`);
    return parts.join("\n");
  });
  return historyLines.filter(Boolean).join("\n");
};

const trimPromptPreservingLatest = (prompt: string, maxLength: number): string => {
  if (prompt.length <= maxLength) return prompt;

  const latestIndex = prompt.lastIndexOf(LATEST_MARKER);
  if (latestIndex <= 0) return prompt.slice(-maxLength).trimStart();

  const latestBlock = prompt.slice(latestIndex);
  if (latestBlock.length >= maxLength) return latestBlock.slice(0, maxLength).trimEnd();

  const prefixBudget = maxLength - latestBlock.length - 1;
  const previousContext = prompt.slice(0, latestIndex).slice(-prefixBudget).trimStart();
  return [previousContext, latestBlock].filter(Boolean).join("\n");
};

const IMAGE_PHASE_RANK: Record<ScenePhase, number> = {
  conversation: 0,
  intimate: 1,
  erotic: 2,
  climax: 3,
  afterglow: 2,
};

const strongerImagePhase = (a: ScenePhase, b: ScenePhase): ScenePhase => {
  if (a === "afterglow" || b === "afterglow") return "afterglow";
  return IMAGE_PHASE_RANK[b] > IMAGE_PHASE_RANK[a] ? b : a;
};

const latestAssistantMessageAsUser = (messages: ChatMessage[]): ChatMessage | null => {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return latestAssistant ? { ...latestAssistant, role: "user" } : null;
};

const messageFromSceneDescription = (content: string): ChatMessage => ({
  id: "image-scene-description",
  role: "user",
  content,
});

// Chat text routing deliberately avoids assistant-driven escalation. Image generation is different:
// it must render the visible completed assistant scene, otherwise the prompt can be explicit while the
// server still receives phase=conversation and falls back to the profile portrait model.
export const detectImageScenePhase = (
  messages: ChatMessage[],
  sceneDescription?: string,
): ScenePhase | null => {
  if (messages.length === 0 && !sceneDescription?.trim()) return null;

  const basePhase = messages.length > 0 ? detectScenePhase(messages) : "conversation";
  const latestAssistant = latestAssistantMessageAsUser(messages);
  const assistantAwarePhase = latestAssistant
    ? detectScenePhase([
        ...messages.filter((message) => message.role !== "assistant"),
        latestAssistant,
      ])
    : basePhase;
  const sceneDescriptionPhase = sceneDescription?.trim()
    ? detectScenePhase([...messages, messageFromSceneDescription(sceneDescription)])
    : basePhase;

  return [assistantAwarePhase, sceneDescriptionPhase].reduce(strongerImagePhase, basePhase);
};

/** Builds the chat-image scene prompt from recent turns while preserving the latest scene. */
export const buildImagePromptFromHistory = (
  messages: ChatMessage[],
  maxLength = DEFAULT_MAX_LENGTH,
  maxTurns = DEFAULT_MAX_TURNS,
): string => {
  const pairs = collectRecentMessagePairs(messages, maxTurns);
  return trimPromptPreservingLatest(formatMessagePairsForPrompt(pairs), maxLength);
};
