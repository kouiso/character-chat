import { useEffect, useMemo, useRef, useState } from "react";

import type { StructuredResponse } from "@/lib/xml-response-parser";

interface PacedRevealConfig {
  actionMsPerChar: number;
  dialogueMsPerChar: number;
  innerMsPerChar: number;
  layerGapMs: number;
  initialDelayMs: number;
}

interface PacedReveal {
  scene: string;
  action: string;
  dialogue: string;
  inner: string;
  narration: string;
  isComplete: boolean;
}

const DEFAULT_CONFIG: PacedRevealConfig = {
  actionMsPerChar: 12,
  dialogueMsPerChar: 23,
  innerMsPerChar: 12,
  layerGapMs: 520,
  initialDelayMs: 650,
};

const EMPTY_REVEAL: PacedReveal = {
  scene: "",
  action: "",
  dialogue: "",
  inner: "",
  narration: "",
  isComplete: true,
};

const sliceByElapsed = (text: string, elapsedMs: number, msPerChar: number): string => {
  if (!text || elapsedMs < 0) return "";
  const visibleLength = Math.min(text.length, Math.floor(elapsedMs / msPerChar));
  return text.slice(0, visibleLength);
};

const buildImmediateReveal = (response: Partial<StructuredResponse> | null): PacedReveal => {
  if (!response) return EMPTY_REVEAL;
  return {
    scene: response.scene ?? "",
    action: response.action ?? "",
    dialogue: response.dialogue ?? "",
    inner: response.inner ?? "",
    narration: response.narration ?? "",
    isComplete: true,
  };
};

const resolveFields = (response: Partial<StructuredResponse>) => ({
  scene: response.scene ?? "",
  action: response.action ?? "",
  dialogue: response.dialogue ?? "",
  inner: response.inner ?? "",
  narration: response.narration ?? "",
});

const buildPacedReveal = (
  response: Partial<StructuredResponse> | null,
  elapsedMs: number,
  config: PacedRevealConfig,
  forceComplete: boolean,
): PacedReveal => {
  if (!response) return EMPTY_REVEAL;
  if (forceComplete) return buildImmediateReveal(response);

  const { scene, action, dialogue, inner, narration } = resolveFields(response);
  const sceneStartMs = config.initialDelayMs;
  const actionStartMs = sceneStartMs + config.layerGapMs;
  const dialogueStartMs =
    actionStartMs + action.length * config.actionMsPerChar + config.layerGapMs;
  const innerStartMs =
    dialogueStartMs + dialogue.length * config.dialogueMsPerChar + config.layerGapMs;
  // narration は地の文なので action と同じテンポで、inner の後に流す
  const narrationStartMs = innerStartMs + inner.length * config.innerMsPerChar + config.layerGapMs;
  const revealed = {
    scene: elapsedMs >= sceneStartMs ? scene : "",
    action: sliceByElapsed(action, elapsedMs - actionStartMs, config.actionMsPerChar),
    dialogue: sliceByElapsed(dialogue, elapsedMs - dialogueStartMs, config.dialogueMsPerChar),
    inner: sliceByElapsed(inner, elapsedMs - innerStartMs, config.innerMsPerChar),
    narration: sliceByElapsed(narration, elapsedMs - narrationStartMs, config.actionMsPerChar),
  };

  return {
    ...revealed,
    isComplete:
      revealed.scene === scene &&
      revealed.action === action &&
      revealed.dialogue === dialogue &&
      revealed.inner === inner &&
      revealed.narration === narration,
  };
};

export function usePacedReveal(
  response: Partial<StructuredResponse> | null,
  isStreaming: boolean,
  config?: Partial<PacedRevealConfig>,
): PacedReveal {
  const resolvedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
  const startedAtRef = useRef<number | null>(null);
  const forceCompleteRef = useRef(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const responseExists = response !== null && response !== undefined;

  useEffect(() => {
    if (!isStreaming || !responseExists) {
      startedAtRef.current = null;
      forceCompleteRef.current = false;
      setElapsedMs(0);
      return;
    }

    startedAtRef.current ??= Date.now();

    const update = () => {
      if (document.visibilityState === "hidden") {
        forceCompleteRef.current = true;
      }
      const startedAt = startedAtRef.current ?? Date.now();
      setElapsedMs(Date.now() - startedAt);
    };

    update();
    const intervalId = window.setInterval(update, 33);
    document.addEventListener("visibilitychange", update);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", update);
    };
  }, [isStreaming, responseExists]);

  if (!isStreaming) return buildImmediateReveal(response);

  return buildPacedReveal(response, elapsedMs, resolvedConfig, forceCompleteRef.current);
}
