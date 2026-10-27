import { proactiveSettingsSchema, proactiveStateSchema } from "./proactive-notification-contract";

import type { ProactiveSettings, ProactiveState } from "./proactive-notification-contract";

export class ProactiveRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 401
        ? "ログインを確認して設定を再読み込みしてください。"
        : status === 404
          ? "キャラクターが見つかりません。"
          : "話しかけ設定を読み書きできません。接続を確認して再試行してください。",
    );
    this.name = "ProactiveRequestError";
    this.status = status;
  }
}

const requestState = async (
  endpoint: string,
  characterId: string,
  options: RequestInit,
): Promise<ProactiveState> => {
  const response = await fetch(endpoint, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  if (!response.ok) throw new ProactiveRequestError(response.status);
  const parsed = proactiveStateSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.characterId !== characterId)
    throw new ProactiveRequestError(503);
  return parsed.data;
};

export const loadProactiveSettings = (
  endpoint: string,
  characterId: string,
  signal?: AbortSignal,
): Promise<ProactiveState> => requestState(endpoint, characterId, { signal });

export const saveProactiveSettings = (
  endpoint: string,
  characterId: string,
  settings: ProactiveSettings,
  signal?: AbortSignal,
): Promise<ProactiveState> =>
  requestState(endpoint, characterId, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proactiveSettingsSchema.parse(settings)),
    signal,
  });
