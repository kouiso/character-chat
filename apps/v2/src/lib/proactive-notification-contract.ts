import { z } from "zod";

const minuteSchema = z.number().int().min(0).max(1439);
const quietHoursSchema = z
  .object({
    startMinute: minuteSchema,
    endMinute: minuteSchema,
  })
  .strict()
  .refine((hours) => hours.startMinute !== hours.endMinute);

export const proactiveSettingsSchema = z
  .object({
    enabled: z.boolean(),
    dailyLimit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    idleMinutes: z
      .number()
      .int()
      .min(1)
      .max(Math.floor(Number.MAX_SAFE_INTEGER / 60_000)),
    quietHours: quietHoursSchema.nullable(),
  })
  .strict();

export const proactiveStateSchema = z
  .object({
    characterId: z.string().min(1).max(256),
    settings: proactiveSettingsSchema,
    schedule: z
      .object({
        characterId: z.string().min(1).max(256),
        alarmId: z.string().min(1).max(256),
        dueAt: z.number().int().min(0).max(8_640_000_000_000_000).nullable(),
      })
      .strict()
      .nullable(),
    timeZone: z.literal("Asia/Tokyo"),
    deliveryMode: z.enum(["mock-only", "unavailable"]),
  })
  .strict()
  .refine((state) => state.schedule === null || state.schedule.characterId === state.characterId);

export type ProactiveSettings = z.infer<typeof proactiveSettingsSchema>;
export type ProactiveState = z.infer<typeof proactiveStateSchema>;
export type ProactiveDeliveryMode = ProactiveState["deliveryMode"];
