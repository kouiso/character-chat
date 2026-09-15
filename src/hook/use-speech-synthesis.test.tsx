import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpeechSynthesis } from "./use-speech-synthesis";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

class MockSpeechSynthesisUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  rate = 1;
  pitch = 1;
  onstart: ((this: SpeechSynthesisUtterance, event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((this: SpeechSynthesisUtterance, event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((this: SpeechSynthesisUtterance, event: SpeechSynthesisErrorEvent) => void) | null =
    null;

  constructor(text = "") {
    this.text = text;
  }
}

const createSpeechEvent = (type: string): SpeechSynthesisEvent =>
  new Event(type) as SpeechSynthesisEvent;

const restoreProperty = (target: object, key: string, value: unknown) => {
  if (typeof value === "undefined") {
    Reflect.deleteProperty(target, key);
    return;
  }

  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
};

const installSpeechSynthesisMock = () => {
  let speaking = false;
  let lastUtterance: MockSpeechSynthesisUtterance | null = null;

  const speechSynthesisMock = {
    get speaking() {
      return speaking;
    },
    get pending() {
      return false;
    },
    get paused() {
      return false;
    },
    onvoiceschanged: null,
    getVoices: vi.fn(() => []),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
      speaking = true;
      lastUtterance = utterance as unknown as MockSpeechSynthesisUtterance;
      lastUtterance.onstart?.call(utterance, createSpeechEvent("start"));
    }),
    cancel: vi.fn(() => {
      speaking = false;
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } satisfies SpeechSynthesis;

  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: MockSpeechSynthesisUtterance,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: MockSpeechSynthesisUtterance,
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: speechSynthesisMock,
  });
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: speechSynthesisMock,
  });

  return {
    getLastUtterance: () => {
      if (lastUtterance === null) {
        throw new Error("SpeechSynthesisUtterance was not spoken");
      }
      return lastUtterance;
    },
    setSpeaking: (value: boolean) => {
      speaking = value;
    },
    speechSynthesisMock,
  };
};

const originalSpeechSynthesis = window.speechSynthesis;
const originalGlobalSpeechSynthesis = globalThis.speechSynthesis;
const originalUtterance = window.SpeechSynthesisUtterance;
const originalGlobalUtterance = globalThis.SpeechSynthesisUtterance;

describe("useSpeechSynthesis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    restoreProperty(window, "speechSynthesis", originalSpeechSynthesis);
    restoreProperty(globalThis, "speechSynthesis", originalGlobalSpeechSynthesis);
    restoreProperty(window, "SpeechSynthesisUtterance", originalUtterance);
    restoreProperty(globalThis, "SpeechSynthesisUtterance", originalGlobalUtterance);
    vi.restoreAllMocks();
  });

  it("clears the watchdog and resets isSpeaking when onend fires normally", async () => {
    const speech = installSpeechSynthesisMock();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechSynthesis("", 1, 1, onEnd));

    act(() => {
      result.current.speak("こんにちは");
    });

    expect(result.current.isSpeaking).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    const utterance = speech.getLastUtterance();
    act(() => {
      utterance.onend?.call(
        utterance as unknown as SpeechSynthesisUtterance,
        createSpeechEvent("end"),
      );
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("forces isSpeaking false when speech stops without onend", async () => {
    const speech = installSpeechSynthesisMock();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechSynthesis("", 1, 1, onEnd));

    act(() => {
      result.current.speak("こんにちは");
    });

    expect(result.current.isSpeaking).toBe(true);

    speech.setSpeaking(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the watchdog when stop is called", async () => {
    const speech = installSpeechSynthesisMock();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useSpeechSynthesis("", 1, 1, onEnd));

    act(() => {
      result.current.speak("こんにちは");
    });

    expect(result.current.isSpeaking).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      result.current.stop();
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    speech.setSpeaking(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
