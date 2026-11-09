// TTS 合成 API（RIT-211）。キャラのボイス設定を読んで VOICEVOX 系エンジンへ中継する。
// エンジン未起動は 503、エンジン側エラーは 502、他人のキャラは 404。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import {
  defaultVoiceSettings,
  engineBaseUrl,
  synthesizeSpeech,
  type VoiceSettings,
} from "./tts";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const ttsBodySchema = z.object({
  characterId: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
});

const ownsCharacter = async (db: D1Database, characterId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT user_id FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const readVoiceSettings = async (db: D1Database, characterId: string): Promise<VoiceSettings> => {
  const row = await db
    .prepare(
      "SELECT engine, speaker_id, speed, pitch, intonation FROM v2_character_voice WHERE character_id = ?",
    )
    .bind(characterId)
    .first<{
      engine: string;
      speaker_id: string;
      speed: number;
      pitch: number;
      intonation: number;
    }>();
  if (!row) return defaultVoiceSettings();
  return {
    engine: row.engine === "aivisspeech" ? "aivisspeech" : "voicevox",
    speakerId: row.speaker_id,
    speed: row.speed,
    pitch: row.pitch,
    intonation: row.intonation,
  };
};

// POST /api/tts {characterId, text} → audio/wav
export const handleTtsRequest = async (request: Request): Promise<Response> => {
  const parsed = ttsBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  const { characterId, text } = parsed.data;
  if (!(await ownsCharacter(env.DB, characterId))) return json(404, { error: "not_found" });
  const settings = await readVoiceSettings(env.DB, characterId);
  try {
    return await synthesizeSpeech(engineBaseUrl(env, settings.engine), settings, text);
  } catch {
    return json(503, { error: "tts_unavailable" });
  }
};
