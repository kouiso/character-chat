// TTS クライアント（RIT-211/212）。レイヤ毎に声色を変えて合成し、順に再生する。
// タグ自体は読み上げない（レイヤ分割で本文だけ残る）。
// サーバの /api/tts は音声エンジン（VOICEVOX 系）が env で指定されている時だけ
// 応答する。Workers 上では localhost エンジンへ届かんので、本番では基本ブラウザ
// 内蔵 TTS（Web Speech API。v1 と同じ方式）へ倒す。
import { messageLayers, type LayerKind } from "./message-layers";

// レイヤ分割に失敗した時の保険としてタグ剥がしも残す。
const stripTags = (text: string): string => text.replace(/<[^>]*>/g, "").trim();

interface Clip {
  play: () => Promise<void>;
  stop: () => void;
}

// サーバ合成が一度失敗したら短時間は再試行せず、各レイヤ往復の無駄を省く。
// エンジンが後から立ち上がった場合もこの秒数で自動復帰する。
const SERVER_TTS_RETRY_MS = 30_000;
let serverTtsDownUntil = 0;

const requestServerClip = async (
  characterId: string,
  text: string,
  layer: LayerKind,
  onEnded: () => void,
): Promise<Clip | null> => {
  if (Date.now() < serverTtsDownUntil) return null;
  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId, text: stripTags(text).slice(0, 500), layer }),
    });
  } catch {
    serverTtsDownUntil = Date.now() + SERVER_TTS_RETRY_MS;
    return null;
  }
  if (!res.ok) {
    // 501 = サーバにエンジン未設定（本番の定常状態）。以後このセッションでは
    // /api/tts を叩かずブラウザ TTS へ直行する。503 等の一時失敗だけが
    // クールダウン再試行の対象（ローカルのエンジン後起動を拾うため）。
    serverTtsDownUntil =
      res.status === 501 ? Number.POSITIVE_INFINITY : Date.now() + SERVER_TTS_RETRY_MS;
    return null;
  }
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    onEnded();
  };
  return {
    play: () => audio.play(),
    stop: () => {
      audio.pause();
      URL.revokeObjectURL(url);
    },
  };
};

// macOS/iOS の日本語女性ボイス優先順位（v1 の use-speech-synthesis と同じ系統）。
const JA_VOICE_PREFERENCE = [/kyoko/i, /o-ren/i, /nanami/i, /sayaka/i, /mei-jia/i, /haruka/i];

const pickJaVoice = (): SpeechSynthesisVoice | null => {
  const ja = speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.replace("_", "-").startsWith("ja"));
  for (const pattern of JA_VOICE_PREFERENCE) {
    const hit = ja.find((v) => pattern.test(v.name) || pattern.test(v.voiceURI));
    if (hit) return hit;
  }
  return ja[0] ?? null;
};

// ブラウザ内蔵 TTS。iOS Safari は自然終了で onend が来ないことがあるので
// speaking 監視の watchdog を併用する（v1 と同じ対策）。
const browserClip = (text: string, onEnded: () => void): Clip | null => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const utterance = new SpeechSynthesisUtterance(stripTags(text).slice(0, 500));
  utterance.lang = "ja-JP";
  const voice = pickJaVoice();
  if (voice) utterance.voice = voice;
  let finished = false;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (watchdog !== null) clearInterval(watchdog);
    onEnded();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  return {
    play: () => {
      speechSynthesis.speak(utterance);
      watchdog = setInterval(() => {
        if (!speechSynthesis.speaking && !speechSynthesis.pending) finish();
      }, 500);
      return Promise.resolve();
    },
    stop: () => {
      finished = true;
      if (watchdog !== null) clearInterval(watchdog);
      speechSynthesis.cancel();
    },
  };
};

const requestVoiceClip = (
  characterId: string,
  text: string,
  layer: LayerKind,
  onEnded: () => void,
): Promise<Clip | null> =>
  requestServerClip(characterId, text, layer, onEnded).then(
    (clip) => clip ?? browserClip(text, onEnded),
  );

export interface VoicePlayback {
  stop: () => void;
}

// RIT-212: レイヤ毎に /api/tts へ layer を渡し、セグメントを連続再生する。
// 読み上げるのは台詞だけ（描写・心の声は音声にしない）。途中で stop() されたら次の合成へ
// 進まない。合成失敗はその場で終了。
export const playVoiceText = (
  characterId: string,
  text: string,
  onEnded: () => void,
): VoicePlayback => {
  const layers = messageLayers(text, false).filter(
    (layer) => layer.kind === "dialogue" && layer.text.trim().length > 0,
  );
  let stopped = false;
  let current: Clip | null = null;
  const finish = () => {
    current = null;
    onEnded();
  };
  const playNext = async (index: number) => {
    if (stopped) return;
    if (index >= layers.length) {
      finish();
      return;
    }
    try {
      const layer = layers[index];
      const clip = await requestVoiceClip(
        characterId,
        layer.text,
        layer.kind,
        () => void playNext(index + 1),
      );
      if (stopped) {
        clip?.stop();
        return;
      }
      if (!clip) {
        finish();
        return;
      }
      current = clip;
      await clip.play();
    } catch {
      finish();
    }
  };
  void playNext(0);
  return {
    stop: () => {
      stopped = true;
      current?.stop();
      current = null;
    },
  };
};

// 通話モード中は通常の自動再生を抑止する（通話ループが再生を握るため二重発話を防ぐ）。
let autoplaySuppressed = false;
export const setVoiceAutoplaySuppressed = (on: boolean): void => {
  autoplaySuppressed = on;
};

// 自動再生の設定値。失敗時は OFF 扱い（鳴らない方向へ倒す）。
export const readVoiceAutoplay = async (): Promise<boolean> => {
  if (autoplaySuppressed) return false;
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "voiceAutoplay" in body &&
      (body as { voiceAutoplay?: unknown }).voiceAutoplay === true
    );
  } catch {
    return false;
  }
};
