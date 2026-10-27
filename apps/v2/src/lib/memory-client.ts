import { memorySnapshotSchema } from "../../../../packages/db/src/memory-contract";

import type { ManagedMemory, MemoryCommand, MemorySnapshot } from "@v2/db";

export class MemoryRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401
        ? "ログインを確認して再読み込みしてください。"
        : status === 409
          ? "記憶が更新されています。再読み込みしてください。"
          : "記憶を読み書きできません。接続を確認して再試行してください。";
    super(message);
    this.name = "MemoryRequestError";
    this.status = status;
  }
}

const requestJson = async (url: string, init: RequestInit): Promise<unknown> => {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) throw new MemoryRequestError(response.status);
  return response.json();
};

export const loadMemorySnapshot = async (
  endpoint: string,
  signal?: AbortSignal,
): Promise<MemorySnapshot> => memorySnapshotSchema.parse(await requestJson(endpoint, { signal }));

export const loadMemoryHistory = async (
  endpoint: string,
  id: string,
  signal?: AbortSignal,
): Promise<ManagedMemory[]> => {
  const separator = endpoint.includes("?") ? "&" : "?";
  const result = await requestJson(`${endpoint}${separator}history=${encodeURIComponent(id)}`, {
    signal,
  });
  return memorySnapshotSchema.pick({ memories: true }).parse(result).memories;
};

export const sendMemoryCommand = async (
  endpoint: string,
  command: MemoryCommand,
): Promise<void> => {
  await requestJson(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
};
