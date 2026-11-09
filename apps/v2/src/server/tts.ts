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
