// 顔の絵の取り込み口。「画像をアップロード」と「この子との会話で作った画像を選ぶ」の
// どちらも、R2 の avatars/<名義>/<UUID>.<拡張子> へ実体を置き、avatar 列へ入れる参照
// （<名義>/<UUID>.<拡張子>）を返すだけにする。保存は既存の版の保存経路が受け持つ。
// 会話の画像は参照ではなくコピーで置く: 元の画像を後で消しても顔が消えんようにするため。
import { createDb } from "@v2/db";

import { LOCAL_USER_ID, listOwnerIds } from "./identity";
import { normalizeType, R2_KEY_PATTERN, sniffMediaType } from "./media";
import { getPlatform } from "./platform";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
// 中身で型を判別できる物だけ受ける（avif は先頭バイトで見分けられず、名乗りだけを信じることになる）。
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const AVATAR_REJECTIONS = {
  notFound: ["character_not_found", "この子が見つかりません。"],
  noFile: ["avatar_file_missing", "画像のファイルを選んでください。"],
  notImage: [
    "avatar_not_image",
    "画像ではないファイルです。PNG・JPEG・WebP・GIF の画像を選んでください。",
  ],
  tooLarge: ["avatar_too_large", "画像が大きすぎます。5MB までの画像を選んでください。"],
  empty: ["avatar_empty", "画像が空です。別のファイルを選んでください。"],
  foreignImage: [
    "avatar_image_not_found",
    "この子との会話の画像ではありません。この子の画像から選んでください。",
  ],
  video: ["avatar_not_still", "動画は顔にできません。画像を選んでください。"],
  storage: ["avatar_storage_failed", "顔を送れませんでした。もう一度試してください。"],
} as const satisfies Record<string, readonly [string, string]>;

const fail = (status: number, key: keyof typeof AVATAR_REJECTIONS): Response =>
  Response.json(
    { code: AVATAR_REJECTIONS[key][0], message: AVATAR_REJECTIONS[key][1] },
    { status },
  );

type Env = Awaited<ReturnType<typeof getPlatform>>["env"];

// 既存のキャラは持ち主の集合に入る物だけ触れる。新規作成中（行が無い）は名義 local の
// 利用者として取り込みだけ許す（保存前の顔を選べるように）。
const characterAccess = async (
  env: Env,
  characterId: string,
  requireExisting: boolean,
): Promise<boolean> => {
  const row = await env.DB.prepare("SELECT user_id FROM character WHERE id = ?")
    .bind(characterId)
    .first<{ user_id: string }>();
  if (!row) return !requireExisting;
  return (await listOwnerIds(createDb(env.DB))).includes(row.user_id);
};

const storeAvatar = async (env: Env, bytes: Uint8Array, type: string): Promise<Response> => {
  const name = `${LOCAL_USER_ID}/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
  try {
    await env.BUCKET.put(`avatars/${name}`, bytes, { httpMetadata: { contentType: type } });
  } catch {
    return fail(502, "storage");
  }
  return Response.json({ avatarRef: name });
};

const checkedImage = (
  bytes: Uint8Array,
): { ok: true; type: string } | { ok: false; response: Response } => {
  if (bytes.byteLength <= 1) return { ok: false, response: fail(400, "empty") };
  if (bytes.byteLength > AVATAR_MAX_BYTES) return { ok: false, response: fail(413, "tooLarge") };
  const sniffed = sniffMediaType(bytes.subarray(0, 12));
  if (!sniffed || !UPLOAD_TYPES.includes(sniffed)) {
    return { ok: false, response: fail(415, "notImage") };
  }
  return { ok: true, type: sniffed };
};

type Picked<T> = { ok: true; value: T } | { ok: false; response: Response };

// 名乗った型が画像でない時は中身を見るまでもなく断る。名乗りが無い時だけ中身で決める。
const declaredTypeAllowed = (raw: string): boolean => {
  const type = normalizeType(raw);
  return !type || type === "application/octet-stream" || UPLOAD_TYPES.includes(type);
};

const readUploadedFile = async (request: Request): Promise<Picked<Uint8Array>> => {
  // 本体を読む前に、名乗った大きさで弾く（multipart の枠の分だけ余裕を見る）。
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > AVATAR_MAX_BYTES + 64 * 1024)
    return { ok: false, response: fail(413, "tooLarge") };
  let file: unknown;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return { ok: false, response: fail(400, "noFile") };
  }
  if (!(file instanceof Blob)) return { ok: false, response: fail(400, "noFile") };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, response: fail(413, "tooLarge") };
  if (!declaredTypeAllowed(file.type)) return { ok: false, response: fail(415, "notImage") };
  return { ok: true, value: new Uint8Array(await file.arrayBuffer()) };
};

const storeChecked = (env: Env, bytes: Uint8Array): Promise<Response> | Response => {
  const checked = checkedImage(bytes);
  return checked.ok ? storeAvatar(env, bytes, checked.type) : checked.response;
};

export const handleAvatarUpload = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const { env } = await getPlatform();
  if (!(await characterAccess(env, characterId, false))) return fail(404, "notFound");
  const read = await readUploadedFile(request);
  return read.ok ? storeChecked(env, read.value) : read.response;
};

// 「この子の」「この利用者の」会話の、消えていない画像だけを引く。条件に合わない id は
// 存在しない id と区別せず同じ拒否にする（他人の会話の画像が在るかを漏らさん）。
const findOwnImageKey = async (
  env: Env,
  characterId: string,
  messageId: string,
): Promise<string | null> => {
  const owners = await listOwnerIds(createDb(env.DB));
  const marks = owners.map(() => "?").join(", ");
  const row = await env.DB.prepare(
    `SELECT coalesce(m.image_key, lm.image_key) AS imageKey
     FROM v2_message m
     JOIN v2_conversation conv ON conv.id = m.conversation_id
     LEFT JOIN message lm ON lm.id = m.id
     WHERE m.id = ? AND m.active = 1 AND conv.character_id = ? AND conv.user_id IN (${marks})`,
  )
    .bind(messageId, characterId, ...owners)
    .first<{ imageKey: string | null }>();
  return row?.imageKey ?? null;
};

const readOwnImage = async (env: Env, imageKey: string): Promise<Picked<Uint8Array>> => {
  if (imageKey.endsWith(".mp4")) return { ok: false, response: fail(415, "video") };
  try {
    const object = await env.BUCKET.get(imageKey);
    if (!object) return { ok: false, response: fail(404, "foreignImage") };
    return { ok: true, value: new Uint8Array(await object.arrayBuffer()) };
  } catch {
    return { ok: false, response: fail(502, "storage") };
  }
};

const parseMessageId = (body: unknown): string | null => {
  const id =
    typeof body === "object" && body !== null && "messageId" in body ? body.messageId : null;
  return typeof id === "string" && id.length > 0 && id.length <= 120 ? id : null;
};

export const handleAvatarFromImage = async (
  characterId: string,
  body: unknown,
): Promise<Response> => {
  const messageId = parseMessageId(body);
  if (!messageId) return fail(400, "foreignImage");
  const { env } = await getPlatform();
  if (!(await characterAccess(env, characterId, true))) return fail(404, "notFound");
  const imageKey = await findOwnImageKey(env, characterId, messageId);
  if (!imageKey || !R2_KEY_PATTERN.test(imageKey)) return fail(404, "foreignImage");
  const read = await readOwnImage(env, imageKey);
  return read.ok ? storeChecked(env, read.value) : read.response;
};

export const handleAvatarPost = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return handleAvatarUpload(characterId, request);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "noFile");
  }
  return handleAvatarFromImage(characterId, body);
};
