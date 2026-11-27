// 顔の絵の取り込み口（POST /api/characters/:id/avatar）の呼び出し。
// 断られた理由はサーバの文面をそのまま画面に出すので、message を持った Error にして返す。
import { z } from "zod";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const FAILED = "顔を送れませんでした。";

const okSchema = z.object({ avatarRef: z.string().min(1) });
const errorSchema = z.object({ message: z.string() });

export class AvatarRequestError extends Error {}

// まだ保存していない新規キャラは id が無いので、取り込み口には予約の名前を渡す。
const avatarPath = (characterId: string | undefined): string =>
  `/api/characters/${encodeURIComponent(characterId ?? "new")}/avatar`;

const send = async (path: string, init: RequestInit): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", ...init });
  } catch {
    throw new AvatarRequestError(`${FAILED}接続を確認して、もう一度試してください。`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = okSchema.safeParse(body);
    if (parsed.success) return parsed.data.avatarRef;
    throw new AvatarRequestError(FAILED);
  }
  const reason = errorSchema.safeParse(body);
  throw new AvatarRequestError(reason.success ? reason.data.message : FAILED);
};

// 画像でない・大きすぎるファイルは送る前に端末で断る（サーバも同じ検査を持つ）。
export const checkAvatarFile = (file: File): string | null => {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    return "画像ではないファイルです。PNG・JPEG・WebP・GIF の画像を選んでください。";
  }
  if (file.size > AVATAR_MAX_BYTES) return "画像が大きすぎます。5MB までの画像を選んでください。";
  return null;
};

export const uploadAvatarFile = (characterId: string | undefined, file: File): Promise<string> => {
  const form = new FormData();
  form.set("file", file);
  return send(avatarPath(characterId), { body: form });
};

export const chooseAvatarImage = (characterId: string, messageId: string): Promise<string> =>
  send(avatarPath(characterId), {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
