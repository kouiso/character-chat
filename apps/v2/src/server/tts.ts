// TTS 抽象化（RIT-210）。エンジン毎の既定 base_url を env で上書きできる。
// 実際の合成呼び出しは RIT-211（/api/tts）でここに生やす。
export const VOICE_ENGINES = ["voicevox", "aivisspeech"] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

export interface VoiceSettings {
  engine: VoiceEngine;
  speakerId: string;
  speed: number;
  pitch: number;
  intonation: number;
}

// 未設定時の既定ボイス（VOICEVOX デフォルトスケール）
export const defaultVoiceSettings = (): VoiceSettings => ({
  engine: "voicevox",
  speakerId: "1",
  speed: 1.0,
  pitch: 0.0,
  intonation: 1.0,
});

interface TtsEnv {
  V2_TTS_VOICEVOX_URL?: string;
  V2_TTS_AIVIS_URL?: string;
}

// エンジン別の接続先。ローカル実行前提の既定値（VOICEVOX:50021 / AivisSpeech:10101）
export const engineBaseUrl = (env: TtsEnv, engine: VoiceEngine): string => {
  if (engine === "aivisspeech")
    return env.V2_TTS_AIVIS_URL ?? "http://localhost:10101";
  return env.V2_TTS_VOICEVOX_URL ?? "http://localhost:50021";
};

// RIT-211: VOICEVOX 系2段合成（audio_query→synthesis）。AivisSpeech は
// VOICEVOX 互換 API なので同じ経路を使う。音声はリクエスト毎に生成（キャッシュ無し）。
export const synthesizeSpeech = async (
  baseUrl: string,
  settings: VoiceSettings,
  text: string,
): Promise<Response> => {
  const speaker = encodeURIComponent(settings.speakerId);
  const queryRes = await fetch(
    `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: "POST" },
  );
  if (!queryRes.ok) throw new Error(`audio_query ${queryRes.status}`);
  const query = (await queryRes.json()) as Record<string, unknown>;
  query.speedScale = settings.speed;
  query.pitchScale = settings.pitch;
  query.intonationScale = settings.intonation;
  const synthRes = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok || synthRes.body === null) throw new Error(`synthesis ${synthRes.status}`);
  return new Response(synthRes.body, {
    status: 200,
    headers: { "content-type": "audio/wav", "cache-control": "no-store" },
  });
};
