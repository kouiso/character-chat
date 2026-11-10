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

// RIT-212: 応答レイヤ種別→声色パラメータの対応表（乗算・加算の差分）。
// inner=囁き寄り（遅め・低め・抑揚弱め）、action=抑揚強め、scene/narration=落ち着き寄り。
// dialogue/不明は差分無し＝既定パラメータ。
export const TTS_LAYERS = ["scene", "action", "dialogue", "inner", "narration"] as const;
export type TtsLayer = (typeof TTS_LAYERS)[number];

const LAYER_VOICE_DELTA: Record<TtsLayer, { speed: number; pitch: number; intonation: number }> = {
  inner: { speed: 0.9, pitch: -0.04, intonation: 0.85 },
  action: { speed: 0.95, pitch: 0, intonation: 1.05 },
  scene: { speed: 1.0, pitch: 0, intonation: 0.95 },
  narration: { speed: 0.95, pitch: 0, intonation: 0.95 },
  dialogue: { speed: 1, pitch: 0, intonation: 1 },
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const layeredSettings = (settings: VoiceSettings, layer?: TtsLayer): VoiceSettings => {
  if (!layer) return settings;
  const d = LAYER_VOICE_DELTA[layer];
  return {
    ...settings,
    speed: clamp(settings.speed * d.speed, 0.5, 2.0),
    pitch: clamp(settings.pitch + d.pitch, -0.15, 0.15),
    intonation: clamp(settings.intonation * d.intonation, 0.0, 2.0),
  };
};

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
  if (engine === "aivisspeech") return env.V2_TTS_AIVIS_URL ?? "http://localhost:10101";
  return env.V2_TTS_VOICEVOX_URL ?? "http://localhost:50021";
};

// RIT-211: VOICEVOX 系2段合成（audio_query→synthesis）。AivisSpeech は
// VOICEVOX 互換 API なので同じ経路を使う。音声はリクエスト毎に生成（キャッシュ無し）。
export const synthesizeSpeech = async (
  baseUrl: string,
  settings: VoiceSettings,
  text: string,
  layer?: TtsLayer,
): Promise<Response> => {
  const v = layeredSettings(settings, layer);
  const speaker = encodeURIComponent(v.speakerId);
  const queryRes = await fetch(
    `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: "POST" },
  );
  if (!queryRes.ok) throw new Error(`audio_query ${queryRes.status}`);
  const query = (await queryRes.json()) as Record<string, unknown>;
  query.speedScale = v.speed;
  query.pitchScale = v.pitch;
  query.intonationScale = v.intonation;
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
