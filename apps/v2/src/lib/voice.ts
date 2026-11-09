// ボイス設定 API クライアント（RIT-210）。
import { z } from "zod";

export const voiceSettingsSchema = z.object({
  engine: z.enum(["voicevox", "aivisspeech"]),
  speakerId: z.string(),
  speed: z.number(),
  pitch: z.number(),
  intonation: z.number(),
  isDefault: z.boolean(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

const voiceUrl = (characterId: string): string =>
  `/api/characters/${encodeURIComponent(characterId)}/voice`;

export const getVoiceSettings = async (characterId: string): Promise<VoiceSettings> => {
  const res = await fetch(voiceUrl(characterId));
  if (!res.ok) throw new Error(`voice get failed: ${res.status}`);
  return voiceSettingsSchema.parse(await res.json());
};

export const putVoiceSettings = async (
  characterId: string,
  body: Omit<VoiceSettings, "isDefault">,
): Promise<VoiceSettings> => {
  const res = await fetch(voiceUrl(characterId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`voice put failed: ${res.status}`);
  return voiceSettingsSchema.parse(await res.json());
};
