// 音声通話モード（RIT-213）。STT(Web Speech API)→送信→TTS 再生のループ。
// 日次無料枠は /api/voice-call/quota で積算し、残り 0 で閉じる。
import { useCallback, useEffect, useRef, useState } from "react";

import { setVoiceAutoplaySuppressed } from "../lib/tts";

export type VoiceCallState = "idle" | "listening" | "thinking" | "speaking" | "blocked";

// Web Speech API は型定義が無い環境があるため必要分だけ宣言する。
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const recognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const voiceCallSupported = (): boolean => recognitionCtor() !== null;

interface VoiceCallDeps {
  sendText: (text: string) => Promise<void>;
  latestAssistant: () => { text: string } | undefined;
  playVoice: (key: string, text: string) => void;
}

const HEARTBEAT_MS = 5000;

export const useVoiceCall = (deps: VoiceCallDeps) => {
  const [state, setState] = useState<VoiceCallState>("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const active = useRef(false);
  const phase = useRef<VoiceCallState>("idle");
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const accrued = useRef(0);
  const depsRef = useRef(deps);

  const setPhase = (next: VoiceCallState) => {
    phase.current = next;
    setState(next);
  };

  const charge = useCallback(async (seconds: number) => {
    try {
      const res = await fetch("/api/voice-call/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seconds }),
      });
      if (!res.ok) return null;
      const body: { remainingSeconds?: number } = await res.json();
      setRemaining(body.remainingSeconds ?? null);
      return body.remainingSeconds ?? null;
    } catch {
      return null;
    }
  }, []);

  const stop = useCallback(() => {
    active.current = false;
    if (heartbeat.current) {
      clearInterval(heartbeat.current);
      heartbeat.current = null;
    }
    recognition.current?.abort();
    recognition.current = null;
    if (accrued.current > 0) {
      const rest = accrued.current;
      accrued.current = 0;
      // 画面を閉じても最終計上だけは届くよう sendBeacon を優先する。
      const payload = JSON.stringify({ seconds: rest });
      if (!navigator.sendBeacon?.("/api/voice-call/quota", payload))
        void fetch("/api/voice-call/quota", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        });
    }
    setPhase("idle");
  }, []);

  // 自己再帰するため ref 実体＋安定ラッパの組合せにする。実体は毎レンダ後に最新化。
  const listenRef = useRef<() => void>(() => {});
  const listen = useCallback(() => listenRef.current(), []);
  const listenBody = () => {
    if (!active.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = [...new Array(event.results.length).keys()]
        .map((i) => event.results[i]?.[0]?.transcript ?? "")
        .join("")
        .trim();
      if (!transcript) return;
      setPhase("thinking");
      void (async () => {
        await depsRef.current.sendText(transcript);
        if (!active.current) return;
        const text = depsRef.current.latestAssistant()?.text;
        if (text) {
          setPhase("speaking");
          depsRef.current.playVoice(`call-${Date.now()}`, text);
          // 再生完了は onPlaybackEnded 経由で listen へ戻る。
        } else {
          listenRef.current();
        }
      })();
    };
    rec.onend = () => {
      // listening のまま切れた時だけ再起動（無音で途切れる端末対策）。
      if (active.current && phase.current === "listening") {
        try {
          rec.start();
        } catch {
          // start 済み例外は握り潰して次の onend に任せる。
        }
      }
    };
    rec.onerror = () => {
      if (active.current) setTimeout(() => listenRef.current(), 800);
    };
    recognition.current = rec;
    setPhase("listening");
    try {
      rec.start();
    } catch {
      listenRef.current();
    }
  };

  useEffect(() => {
    depsRef.current = deps;
    listenRef.current = listenBody;
  });

  // TTS 再生が終わったらマイクへ戻る（ChatView 側の playVoice onEnded から呼ばれる）。
  const onPlaybackEnded = useCallback(() => {
    if (active.current) listen();
  }, [listen]);

  const start = useCallback(async () => {
    if (active.current) return;
    try {
      const res = await fetch("/api/voice-call/quota");
      const body: { remainingSeconds?: number } = res.ok ? await res.json() : {};
      const left = body.remainingSeconds ?? 0;
      setRemaining(left);
      if (left <= 0) {
        setPhase("blocked");
        return;
      }
    } catch {
      setRemaining(null);
    }
    active.current = true;
    accrued.current = 0;
    heartbeat.current = setInterval(() => {
      accrued.current += HEARTBEAT_MS / 1000;
      const chunk = accrued.current;
      accrued.current = 0;
      void charge(chunk).then((left) => {
        if (left !== null && left <= 0) {
          setPhase("blocked");
          stop();
        }
      });
    }, HEARTBEAT_MS);
    listen();
  }, [charge, listen, stop]);

  // 通話中は通常の自動再生を抑止（通話ループ側が再生を握る）。
  useEffect(() => {
    setVoiceAutoplaySuppressed(
      state === "listening" || state === "thinking" || state === "speaking",
    );
  }, [state]);

  useEffect(
    () => () => {
      active.current = false;
      if (heartbeat.current) clearInterval(heartbeat.current);
      recognition.current?.abort();
      setVoiceAutoplaySuppressed(false);
    },
    [],
  );

  return { state, remaining, start, stop, onPlaybackEnded };
};
