import {
  proactiveSettingsSchema,
  proactiveStateSchema,
} from "../lib/proactive-notification-contract";

import { DEFAULT_PROACTIVE_DAILY_LIMIT } from "./proactive-notification-policy";

import type { ProactiveCharacterSettings } from "./proactive-notification-policy";
import type { ProactiveCharacterState, ProactiveSchedule } from "./proactive-notification-store";
import type {
  ProactiveDeliveryMode,
  ProactiveSettings,
  ProactiveState,
} from "../lib/proactive-notification-contract";

export type ProactiveRecipient = {
  getCharacterState(characterId: string): Promise<ProactiveCharacterState>;
  getCharacterSettings(characterId: string): Promise<ProactiveCharacterSettings | undefined>;
  getSchedule(): Promise<ProactiveSchedule[]>;
  configureCharacter(characterId: string, settings: ProactiveCharacterSettings): Promise<void>;
  recordActivity(characterId: string, activityId?: string): Promise<void>;
};

export type ProactiveControllerDependencies = {
  recipientId: string;
  verifyCharacter(
    recipientId: string,
    characterId: string,
  ): Promise<{ proactiveSettings: { intervalMinutes: number } } | null>;
  getRecipient(recipientId: string): ProactiveRecipient | Promise<ProactiveRecipient>;
  deliveryMode: ProactiveDeliveryMode;
};

export class ProactiveCharacterNotFoundError extends Error {
  constructor() {
    super("キャラクターが見つかりません。");
    this.name = "ProactiveCharacterNotFoundError";
  }
}

export class ProactiveSettingsInvalidError extends Error {
  constructor() {
    super("話しかけ設定の入力内容を確認してください。");
    this.name = "ProactiveSettingsInvalidError";
  }
}

export class ProactiveSettingsUnavailableError extends Error {
  constructor() {
    super("話しかけ設定を読み書きできません。接続を確認して再試行してください。");
    this.name = "ProactiveSettingsUnavailableError";
  }
}

export const createProactiveNotificationController = (
  dependencies: ProactiveControllerDependencies,
) => {
  const recipientId = dependencies.recipientId;
  const verify = async (characterId: string) => {
    if (typeof characterId !== "string" || !characterId.trim() || characterId.length > 256)
      throw new ProactiveCharacterNotFoundError();
    const profile = await dependencies.verifyCharacter(recipientId, characterId);
    if (!profile) throw new ProactiveCharacterNotFoundError();
    return profile;
  };

  const read = async (
    characterId: string,
    recipient: ProactiveRecipient,
    intervalMinutes: number,
  ): Promise<ProactiveState> => {
    const { settings: saved, schedule } = await recipient.getCharacterState(characterId);
    // 共有profileのenabledは受信者本人のopt-inではないため、自動でONに移さない。
    const settings: ProactiveSettings = saved ?? {
      enabled: false,
      dailyLimit: DEFAULT_PROACTIVE_DAILY_LIMIT,
      idleMinutes: intervalMinutes,
      quietHours: null,
    };
    const state = proactiveStateSchema.safeParse({
      characterId,
      settings,
      schedule: schedule ?? null,
      timeZone: "Asia/Tokyo",
      deliveryMode: dependencies.deliveryMode,
    });
    if (!state.success) throw new ProactiveSettingsUnavailableError();
    return state.data;
  };

  return {
    load: async (characterId: string): Promise<ProactiveState> => {
      const profile = await verify(characterId);
      return read(
        characterId,
        await dependencies.getRecipient(recipientId),
        profile.proactiveSettings.intervalMinutes,
      );
    },
    configure: async (characterId: string, input: unknown): Promise<ProactiveState> => {
      const profile = await verify(characterId);
      const settings = proactiveSettingsSchema.safeParse(input);
      if (!settings.success) throw new ProactiveSettingsInvalidError();
      const recipient = await dependencies.getRecipient(recipientId);
      try {
        await recipient.configureCharacter(characterId, settings.data);
      } catch (error) {
        if (error instanceof RangeError) throw new ProactiveSettingsInvalidError();
        throw error;
      }
      return read(characterId, recipient, profile.proactiveSettings.intervalMinutes);
    },
    recordActivity: async (characterId: string): Promise<void> => {
      await verify(characterId);
      await (await dependencies.getRecipient(recipientId)).recordActivity(characterId);
    },
  };
};
