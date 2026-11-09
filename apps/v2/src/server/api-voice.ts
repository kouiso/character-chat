// キャラ別ボイス設定 API（RIT-210）。v2_character_voice に1行、未設定は既定値へ倒す。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { VOICE_ENGINES, defaultVoiceSettings } from "./tts";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const voiceBodySchema = z.object({
  engine: z.enum(VOICE_ENGINES),
  speakerId: z.string().min(1).max(64),
  speed: z.number().min(0.5).max(2.0),
  pitch: z.number().min(-0.15).max(0.15),
  intonation: z.number().min(0.0).max(2.0),
});

const ownsCharacter = async (db: D1Database, characterId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT user_id FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  return row?.user_id === LOCAL_USER_ID;
};

const readVoice = async (db: D1Database, characterId: string) => {
  const row = await db
    .prepare(
      "SELECT engine, speaker_id, speed, pitch, intonation, updated_at FROM v2_character_voice WHERE character_id = ?",
    )
    .bind(characterId)
    .first<{
      engine: string;
      speaker_id: string;
      speed: number;
      pitch: number;
      intonation: number;
      updated_at: number;
    }>();
  if (!row) return { ...defaultVoiceSettings(), isDefault: true };
  return {
    engine: row.engine,
    speakerId: row.speaker_id,
    speed: row.speed,
    pitch: row.pitch,
    intonation: row.intonation,
    isDefault: false,
  };
};

export const handleVoiceGet = async (characterId: string): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, characterId))) return json(404, { error: "not_found" });
  return json(200, await readVoice(env.DB, characterId));
};

export const handleVoicePut = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await ownsCharacter(env.DB, characterId))) return json(404, { error: "not_found" });
  const raw = await request.json();
  const parsed = voiceBodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const v = parsed.data;
  await env.DB.prepare(
    `INSERT INTO v2_character_voice (character_id, engine, speaker_id, speed, pitch, intonation, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       engine = excluded.engine, speaker_id = excluded.speaker_id,
       speed = excluded.speed, pitch = excluded.pitch, intonation = excluded.intonation,
       updated_at = excluded.updated_at`,
  )
    .bind(characterId, v.engine, v.speakerId, v.speed, v.pitch, v.intonation, Date.now())
    .run();
  return json(200, await readVoice(env.DB, characterId));
};
