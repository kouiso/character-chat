// TTS クライアント（RIT-211）。/api/tts で wav を取得し Audio で再生する。
// <inner> 等のタグは読み上げ対象外なので剥がす。
const stripTags = (text: string): string => text.replace(/<[^>]*>/g, "").trim();

export const requestVoice = async (
  characterId: string,
  text: string,
  onEnded?: () => void,
): Promise<HTMLAudioElement> => {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId, text: stripTags(text).slice(0, 500) }),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    onEnded?.();
  };
  return audio;
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
