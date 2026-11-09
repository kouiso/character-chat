// TTS クライアント（RIT-211/212）。レイヤ毎に声色を変えて合成し、順に再生する。
// タグ自体は読み上げない（レイヤ分割で本文だけ残る）。
import { messageLayers, type LayerKind } from "./message-layers";

// レイヤ分割に失敗した時の保険としてタグ剥がしも残す。
const stripTags = (text: string): string => text.replace(/<[^>]*>/g, "").trim();

const requestVoiceClip = async (
  characterId: string,
  text: string,
  layer: LayerKind,
  onEnded: () => void,
): Promise<HTMLAudioElement> => {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId, text: stripTags(text).slice(0, 500), layer }),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    onEnded();
  };
  return audio;
};

export interface VoicePlayback {
  stop: () => void;
}

// RIT-212: レイヤ毎に /api/tts へ layer を渡し、セグメントを連続再生する。
// 途中で stop() されたら次の合成へ進まない。合成失敗はその場で終了。
export const playVoiceText = (
  characterId: string,
  text: string,
  onEnded: () => void,
): VoicePlayback => {
  const layers = messageLayers(text, false).filter((layer) => layer.text.trim().length > 0);
  let stopped = false;
  let current: HTMLAudioElement | null = null;
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
      const audio = await requestVoiceClip(characterId, layer.text, layer.kind, () =>
        void playNext(index + 1),
      );
      if (stopped) {
        URL.revokeObjectURL(audio.src);
        return;
      }
      current = audio;
      await audio.play();
    } catch {
      finish();
    }
  };
  void playNext(0);
  return {
    stop: () => {
      stopped = true;
      current?.pause();
      current = null;
    },
  };
};

// 自動再生の設定値。失敗時は OFF 扱い（鳴らない方向へ倒す）。
export const readVoiceAutoplay = async (): Promise<boolean> => {
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
