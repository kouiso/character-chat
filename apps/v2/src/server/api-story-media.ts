// 章からのコミック・プロットビデオ変換（RIT-217）。既存の会話4コマ・動画変換と同じ
// Novita/Runware・課金台帳経路を使い、生成物は v2_chapter の列へ紐付ける。
import { loadOwnedChapter } from "./api-story-illustration";
import { CurrencyError } from "./currency";
import { chargeGeneration, refundGenerationBestEffort } from "./generation-billing";
import { LOCAL_USER_ID } from "./identity";
import {
  COMIC_PANEL_COUNT,
  COMIC_PANEL_FRAMING,
  fetchImageBytes,
  pollForImage,
  prepareImageJob,
  readCharacterVisual,
  splitSceneBeats,
  type ImageEnv,
} from "./image-generation";
import { createNovitaClient, type NovitaTxt2ImgInput } from "./image-novita";
import { getPlatform } from "./platform";
import {
  findTaskItem,
  MOTION_HINT,
  runwareCall,
  uploadFrameImage,
  VIDEO_DURATION_SECONDS,
  VIDEO_MODEL,
  VIDEO_RESOLUTION,
  type VideoEnv,
} from "./video-generation";

type MediaEnv = ImageEnv & VideoEnv;

// ---------- 4コマ ----------

const chargePanel = async (env: MediaEnv, generationId: string): Promise<string | null> => {
  try {
    await chargeGeneration(env.DB, { userId: "local", generationId, kind: "image" });
    return null;
  } catch (error) {
    return error instanceof CurrencyError ? error.message : "課金に失敗しました。";
  }
};

// 1コマ分の生成。失敗は null を返し、呼び出し側でコマ単位の成否を集計する。
const generatePanel = async (deps: {
  env: MediaEnv;
  generationId: string;
  params: NovitaTxt2ImgInput;
  fetchImpl?: typeof fetch;
}): Promise<string | null> => {
  const { env } = deps;
  const refund = () =>
    refundGenerationBestEffort(env.DB, {
      userId: "local",
      generationId: deps.generationId,
      kind: "image",
    });
  try {
    const client = createNovitaClient({
      apiKey: env.NOVITA_API_KEY,
      apiBase: env.MOCK_API_BASE,
      fetchImpl: deps.fetchImpl,
    });
    const taskId = await client.initTxt2Img(deps.params);
    const result = await pollForImage(client, taskId);
    if ("failedReason" in result) {
      await refund();
      return null;
    }
    const bytes = await fetchImageBytes(deps.fetchImpl ?? fetch, result.imageUrl);
    const imageKey = `images/${crypto.randomUUID()}.png`;
    await env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: "image/png" } });
    return imageKey;
  } catch {
    await refund();
    return null;
  }
};

export type ChapterComicResult =
  | { ok: true; panels: (string | null)[]; comicUrls: (string | null)[] }
  | { ok: false; status: number; message: string };

export const generateChapterComic = async (input: {
  env: MediaEnv;
  storyId: string;
  chapterId: string;
  fetchImpl?: typeof fetch;
}): Promise<ChapterComicResult> => {
  const { env } = input;
  const chapter = await loadOwnedChapter(env, input.storyId, input.chapterId);
  if (!chapter) return { ok: false, status: 404, message: "章が見つかりません。" };
  const visual = await readCharacterVisual(env.DB, chapter.characterId);
  const beats = splitSceneBeats([chapter.narration, chapter.body].filter(Boolean).join("\n"));

  const jobs = [...new Array(COMIC_PANEL_COUNT).keys()].map((panelIndex) => {
    const scene = [COMIC_PANEL_FRAMING[panelIndex], beats[panelIndex]]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(", ");
    return {
      panelIndex,
      ...prepareImageJob(
        visual,
        [{ role: "assistant", content: scene }],
        "conversation",
        1,
        undefined,
      ),
    };
  });
  if (jobs.some((job) => !job.prompt)) {
    return {
      ok: false,
      status: 422,
      message: "キャラクターの外見設定がないためコミックを生成できません。",
    };
  }

  const panels = await Promise.all(
    jobs.map(async (job) => {
      const generationId = crypto.randomUUID();
      const chargeError = await chargePanel(env, generationId);
      if (chargeError) return null;
      return generatePanel({
        env,
        generationId,
        params: { prompt: job.prompt, negativePrompt: job.negativePrompt, ...job.params },
        fetchImpl: input.fetchImpl,
      });
    }),
  );
  await env.DB.prepare("UPDATE v2_chapter SET comic_keys = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(panels), Date.now(), chapter.id)
    .run();
  return {
    ok: true,
    panels,
    comicUrls: panels.map((key, i) =>
      key ? `/api/chapter-media/${encodeURIComponent(chapter.id)}?panel=${i}` : null,
    ),
  };
};

export const handleChapterComicPost = async (
  storyId: string,
  chapterId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  const result = await generateChapterComic({ env, storyId, chapterId });
  return Response.json(result, { status: result.ok ? 200 : result.status });
};

// コミックの n コマ目の R2 キー。所有者確認つき。
export const readChapterComicPanelKey = async (
  db: D1Database,
  chapterId: string,
  panel: number,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT c.comic_keys AS keys FROM v2_chapter c JOIN v2_story s ON s.id = c.story_id " +
        "WHERE c.id = ? AND s.user_id = ?",
    )
    .bind(chapterId, LOCAL_USER_ID)
    .first<{ keys: string | null }>();
  if (!row?.keys) return null;
  try {
    const keys = JSON.parse(row.keys) as (string | null)[];
    return keys[panel] ?? null;
  } catch {
    return null;
  }
};

// ---------- プロットビデオ ----------

type ChapterVideoRow = {
  imageKey: string | null;
  videoKey: string | null;
  videoTaskId: string | null;
};

const loadChapterMedia = async (
  env: MediaEnv,
  storyId: string,
  chapterId: string,
): Promise<ChapterVideoRow | null> =>
  env.DB.prepare(
    "SELECT c.image_key AS imageKey, c.video_key AS videoKey, c.video_task_id AS videoTaskId " +
      "FROM v2_chapter c JOIN v2_story s ON s.id = c.story_id " +
      "WHERE c.id = ? AND c.story_id = ? AND s.user_id = ?",
  )
    .bind(chapterId, storyId, LOCAL_USER_ID)
    .first<ChapterVideoRow>();

const failVideo = async (
  env: MediaEnv,
  generationId: string,
  chapterId: string,
  reason: string,
): Promise<{ ok: false; status: number; message: string }> => {
  await env.DB.prepare("UPDATE v2_chapter SET video_task_id = NULL, updated_at = ? WHERE id = ?")
    .bind(Date.now(), chapterId)
    .run();
  await refundGenerationBestEffort(env.DB, { userId: "local", generationId, kind: "video" });
  return { ok: false, status: 502, message: `動画を生成できませんでした（${reason}）。` };
};

export type ChapterVideoResult =
  | { ok: true; status: "processing" | "ok"; videoUrl?: string }
  | { ok: false; status: number; message: string };

// 上流への起動部分。失敗は failVideo が task id 消去＋返金をまとめて処理する。
const launchVideo = async (
  env: MediaEnv,
  deps: {
    chapterId: string;
    generationId: string;
    imageKey: string;
    prompt: string;
    fetchImpl?: typeof fetch;
  },
): Promise<ChapterVideoResult> => {
  try {
    const mediaUUID = await uploadFrameImage(env, deps.fetchImpl ?? fetch, deps.imageKey);
    const taskUUID = crypto.randomUUID();
    const { error } = await runwareCall(env, deps.fetchImpl ?? fetch, {
      taskType: "videoInference",
      taskUUID,
      model: VIDEO_MODEL,
      positivePrompt: deps.prompt,
      duration: VIDEO_DURATION_SECONDS,
      resolution: VIDEO_RESOLUTION,
      inputs: { frameImages: [{ image: mediaUUID, frame: "first" }] },
      deliveryMethod: "async",
      safety: { checkContent: false },
    });
    if (error) return await failVideo(env, deps.generationId, deps.chapterId, error);
    await env.DB.prepare("UPDATE v2_chapter SET video_task_id = ?, updated_at = ? WHERE id = ?")
      .bind(taskUUID, Date.now(), deps.chapterId)
      .run();
    return { ok: true, status: "processing" };
  } catch (error) {
    return await failVideo(
      env,
      deps.generationId,
      deps.chapterId,
      error instanceof Error ? error.message : String(error),
    );
  }
};

// 起動: 章挿絵を first-frame に Runware videoInference へ投げ、task id を章へ残す。
export const startChapterVideo = async (input: {
  env: MediaEnv;
  storyId: string;
  chapterId: string;
  fetchImpl?: typeof fetch;
}): Promise<ChapterVideoResult> => {
  const { env } = input;
  const chapter = await loadOwnedChapter(env, input.storyId, input.chapterId);
  if (!chapter) return { ok: false, status: 404, message: "章が見つかりません。" };
  const media = await loadChapterMedia(env, input.storyId, input.chapterId);
  if (!media?.imageKey) {
    return { ok: false, status: 422, message: "先に章の挿絵を生成してください。" };
  }
  const generationId = crypto.randomUUID();
  try {
    await chargeGeneration(env.DB, { userId: "local", generationId, kind: "video" });
  } catch (error) {
    if (error instanceof CurrencyError) {
      return { ok: false, status: error.status, message: error.message };
    }
    throw error;
  }

  const promptBase = [chapter.narration, chapter.body.slice(0, 200)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
  return launchVideo(env, {
    chapterId: chapter.id,
    generationId,
    imageKey: media.imageKey,
    prompt: promptBase ? `${promptBase}, ${MOTION_HINT}` : MOTION_HINT,
    fetchImpl: input.fetchImpl,
  });
};

// 完了した動画の取得→R2→章への保存。
const completeChapterVideo = async (
  env: MediaEnv,
  chapterId: string,
  upstreamUrl: string,
  videoUrl: string,
  fetchImpl: typeof fetch,
): Promise<ChapterVideoResult> => {
  const response = await fetchImpl(upstreamUrl);
  if (!response.ok) {
    return { ok: false, status: 502, message: "動画の取得に失敗しました。" };
  }
  const bytes = await response.arrayBuffer();
  const videoKey = `videos/${crypto.randomUUID()}.mp4`;
  await env.BUCKET.put(videoKey, bytes, { httpMetadata: { contentType: "video/mp4" } });
  await env.DB.prepare(
    "UPDATE v2_chapter SET video_key = ?, video_task_id = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(videoKey, Date.now(), chapterId)
    .run();
  return { ok: true, status: "ok", videoUrl };
};

// Runware の getResponse で動画の upstream URL を引く。未完了は url 無し。
const queryUpstreamVideoUrl = async (
  env: MediaEnv,
  taskId: string,
  fetchImpl: typeof fetch,
): Promise<{ url?: string; error?: string }> => {
  const { data, error } = await runwareCall(env, fetchImpl, {
    taskType: "getResponse",
    taskUUID: taskId,
  });
  if (error) return { error };
  const item = findTaskItem(data, "videoInference", taskId);
  const url = item && typeof item.videoURL === "string" ? item.videoURL : undefined;
  return { url };
};

// 完了問い合わせ。videoURL が来たら R2 へ保存して video_key を章へ書く。
export const pollChapterVideo = async (input: {
  env: MediaEnv;
  storyId: string;
  chapterId: string;
  fetchImpl?: typeof fetch;
}): Promise<ChapterVideoResult> => {
  const { env } = input;
  const chapter = await loadOwnedChapter(env, input.storyId, input.chapterId);
  if (!chapter) return { ok: false, status: 404, message: "章が見つかりません。" };
  const media = await loadChapterMedia(env, input.storyId, input.chapterId);
  const videoUrl = `/api/chapter-video/${encodeURIComponent(chapter.id)}`;
  if (media?.videoKey) return { ok: true, status: "ok", videoUrl };
  if (!media?.videoTaskId)
    return { ok: false, status: 409, message: "動画生成を先に起動してください。" };

  const polled = await queryUpstreamVideoUrl(env, media.videoTaskId, input.fetchImpl ?? fetch);
  if (polled.error) {
    return {
      ok: false,
      status: 502,
      message: `動画の状態を取得できませんでした（${polled.error}）。`,
    };
  }
  if (!polled.url) return { ok: true, status: "processing" };
  return completeChapterVideo(env, chapter.id, polled.url, videoUrl, input.fetchImpl ?? fetch);
};

export const handleChapterVideoPost = async (
  storyId: string,
  chapterId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  const result = await startChapterVideo({ env, storyId, chapterId });
  return Response.json(result, { status: result.ok ? 202 : result.status });
};

export const handleChapterVideoGet = async (
  storyId: string,
  chapterId: string,
): Promise<Response> => {
  const { env } = await getPlatform();
  const result = await pollChapterVideo({ env, storyId, chapterId });
  return Response.json(result, { status: result.ok ? 200 : result.status });
};

// 章動画の配信用キー。所有者確認つき。
export const readChapterVideoKey = async (
  db: D1Database,
  chapterId: string,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT c.video_key AS videoKey FROM v2_chapter c JOIN v2_story s ON s.id = c.story_id " +
        "WHERE c.id = ? AND s.user_id = ?",
    )
    .bind(chapterId, LOCAL_USER_ID)
    .first<{ videoKey: string | null }>();
  return row?.videoKey ?? null;
};
