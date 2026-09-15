export type SharedPayloadOptions = {
  conversationId: string;
  title: string | null;
  character: { id: string; name: string; avatar: string | null };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    imageUrl: string | null;
    createdAt: number;
  }>;
  now: number;
};

export type SharedPayload = SharedPayloadOptions;

export function buildSharedPayload(options: SharedPayloadOptions): SharedPayload {
  return options;
}

export function serializeSharedPayload(
  payload: SharedPayload,
): { ok: true; json: string; bytes: number } | { ok: false; bytes: number } {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > 900_000) return { ok: false, bytes };
  return { ok: true, json, bytes };
}

export function isValidShareId(shareId: string): boolean {
  if (shareId.length !== 36) return false;
  if (shareId[8] !== "-" || shareId[13] !== "-" || shareId[18] !== "-" || shareId[23] !== "-") {
    return false;
  }

  const hexCharacters = shareId.replaceAll("-", "");
  return hexCharacters.length === 32 && /^[\da-f]+$/.test(hexCharacters);
}

export function parseSharedPayload(
  json: string,
): { ok: true; payload: SharedPayload } | { ok: false } {
  try {
    const payload = JSON.parse(json) as SharedPayload;
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}
