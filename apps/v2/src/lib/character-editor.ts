import { storedCharacterContentSchema } from "@v2/db/character-version";
import { z } from "zod";

export const characterDetailSchema = z.object({
  id: z.string(),
  revision: z.number().int().nonnegative(),
  currentVersionId: z.string().nullable(),
  content: storedCharacterContentSchema,
});
export type CharacterDetail = z.infer<typeof characterDetailSchema>;

export const characterVersionsSchema = z.object({
  currentVersionId: z.string().nullable(),
  versions: z.array(
    z.object({
      id: z.string(),
      version: z.number().int(),
      createdAt: z.number(),
    }),
  ),
});
export type CharacterVersions = z.infer<typeof characterVersionsSchema>;

export const savedCharacterSchema = z.object({ id: z.string(), revision: z.number() });

export class CharacterRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      status === 409
        ? "別の画面で変更されています。入力は残っています。最新の内容を読み直してから保存してください。"
        : status === 404
          ? "キャラクターまたは指定された版が見つかりません。"
          : status === 400 || status === 422
            ? "入力内容を確認してください。文字数や必須項目が条件を満たしていません。"
            : "保存先に接続できませんでした。入力を残しているので、再試行してください。",
    );
    this.status = status;
    this.name = "CharacterRequestError";
  }
}

export const requestCharacter = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) throw new CharacterRequestError(response.status);
  return schema.parse(await response.json());
};

export const characterPath = (id: string): string => `/api/characters/${encodeURIComponent(id)}`;
