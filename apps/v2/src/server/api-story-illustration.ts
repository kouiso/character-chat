// 章挿絵の生成（RIT-215）。会話画像と同じ Novita txt2img＋課金台帳経路を使うが、
// 紐付け先は v2_message ではなく v2_chapter.image_key。
import { CurrencyError } from "./currency";
import { chargeGeneration, refundGenerationBestEffort } from "./generation-billing";
import { LOCAL_USER_ID } from "./identity";
import {
  fetchImageBytes,
  pollForImage,
  prepareImageJob,
  readCharacterVisual,
  type ImageEnv,
} from "./image-generation";
import { createNovitaClient } from "./image-novita";
import { getPlatform } from "./platform";

export type ChapterOwnerRow = {
  id: string;
  storyId: string;
  characterId: string;
  title: string;
  body: string;
  narration: string;
};

// 章＋ストーリー＋キャラを所有者確認つきで引く。他人の章は 404 側へ倒す。
export const loadOwnedChapter = async (
  env: ImageEnv,
  storyId: string,
  chapterId: string,
): Promise<ChapterOwnerRow | null> =>
  env.DB.prepare(
    "SELECT c.id, c.story_id AS storyId, s.character_id AS characterId, c.title, c.body, c.narration " +
      "FROM v2_chapter c JOIN v2_story s ON s.id = c.story_id " +
      "WHERE c.id = ? AND c.story_id = ? AND s.user_id = ?",
  )
    .bind(chapterId, storyId, LOCAL_USER_ID)
    .first<ChapterOwnerRow>();

export type ChapterIllustrationResult =
  | { ok: true; imageUrl: string; imageKey: string }
  | { ok: false; status: number; message: string };

// charge 後の生成実行部。init→poll→R2→D1 更新のどこで落ちても fail() が同額を返す。
const runIllustration = async (deps: {
  env: ImageEnv;
  chapterId: string;
  generationId: string;
  params: Parameters<ReturnType<typeof createNovitaClient>["initTxt2Img"]>[0];
  fetchImpl?: typeof fetch;
}): Promise<ChapterIllustrationResult> => {
  const { env } = deps;
  const client = createNovitaClient({
    apiKey: env.NOVITA_API_KEY,
    apiBase: env.MOCK_API_BASE,
    fetchImpl: deps.fetchImpl,
  });
  const fail = async (reason: string): Promise<ChapterIllustrationResult> => {
    await refundGenerationBestEffort(env.DB, {
      userId: "local",
      generationId: deps.generationId,
      kind: "image",
    });
    return { ok: false, status: 502, message: `挿絵を生成できませんでした（${reason}）。` };
  };

  let taskId: string;
  try {
    taskId = await client.initTxt2Img(deps.params);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const result = await pollForImage(client, taskId).catch((error: unknown) => ({
    failedReason: error instanceof Error ? error.message : String(error),
  }));
  if ("failedReason" in result) return fail(result.failedReason);

  try {
    const bytes = await fetchImageBytes(deps.fetchImpl ?? fetch, result.imageUrl);
    const imageKey = `images/${crypto.randomUUID()}.png`;
    await env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: "image/png" } });
    await env.DB.prepare("UPDATE v2_chapter SET image_key = ?, updated_at = ? WHERE id = ?")
      .bind(imageKey, Date.now(), deps.chapterId)
      .run();
    return {
      ok: true,
      imageUrl: `/api/chapter-media/${encodeURIComponent(deps.chapterId)}`,
      imageKey,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

export const generateChapterIllustration = async (input: {
  env: ImageEnv;
  storyId: string;
  chapterId: string;
  fetchImpl?: typeof fetch;
}): Promise<ChapterIllustrationResult> => {
  const { env } = input;
  const chapter = await loadOwnedChapter(env, input.storyId, input.chapterId);
  if (!chapter) {
    return { ok: false, status: 404, message: "章が見つかりません。" };
  }
  const visual = await readCharacterVisual(env.DB, chapter.characterId);
  // 章の場面はナレーション＋本文の先頭を assistant 発言として擬制し、会話画像の
  // プロンプト組み立て（anchor・guardrail・quality tail）をそのまま通す。
  const scene = [chapter.narration, chapter.body].filter(Boolean).join("\n").slice(0, 600);
  const { params, prompt, negativePrompt } = prepareImageJob(
    visual,
    [{ role: "assistant", content: scene }],
    "conversation",
    1,
    undefined,
  );
  if (!prompt) {
    return {
      ok: false,
      status: 422,
      message: "キャラクターの外見設定がないため挿絵を生成できません。",
    };
  }

  const generationId = crypto.randomUUID();
  // 課金台帳は会話画像と同じ charge/refund 経路。失敗したら同額を返す。
  try {
    await chargeGeneration(env.DB, { userId: "local", generationId, kind: "image" }, env);
  } catch (error) {
    if (error instanceof CurrencyError) {
      return { ok: false, status: error.status, message: error.message };
    }
    throw error;
  }
  return runIllustration({
    env,
    chapterId: chapter.id,
    generationId,
    params: { prompt, negativePrompt, ...params },
    fetchImpl: input.fetchImpl,
  });
};

export const handleChapterIllustrationPost = async (
  storyId: string,
  chapterId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  const result = await generateChapterIllustration({ env, storyId, chapterId });
  return Response.json(result, { status: result.ok ? 200 : result.status });
};

// 章画像の配信用キー。所有者確認つきで image_key を返す（/api/chapter-media/:id）。
export const readChapterImageKey = async (
  db: D1Database,
  chapterId: string,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT c.image_key AS imageKey FROM v2_chapter c JOIN v2_story s ON s.id = c.story_id " +
        "WHERE c.id = ? AND s.user_id = ?",
    )
    .bind(chapterId, LOCAL_USER_ID)
    .first<{ imageKey: string | null }>();
  return row?.imageKey ?? null;
};
