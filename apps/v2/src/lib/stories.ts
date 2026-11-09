// ストーリー API クライアント（RIT-214）。
export type StorySummary = {
  id: string;
  title: string;
  characterId: string;
  characterName: string | null;
  worldview: string;
  chapterCount: number;
  updatedAt: number;
};

export type StoryChapter = {
  id: string;
  ord: number;
  title: string;
  body: string;
  narration: string;
  updatedAt: number;
};

export type StoryDetail = Omit<StorySummary, "chapterCount" | "characterName"> & {
  createdAt: number;
  chapters: StoryChapter[];
};

const readJson = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as T;
};

export const loadStories = (): Promise<StorySummary[]> =>
  fetch("/api/stories").then((res) => readJson<StorySummary[]>(res));

export const createStory = (input: {
  characterId: string;
  title: string;
  worldview?: string;
}): Promise<{ id: string }> =>
  fetch("/api/stories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => readJson<{ id: string }>(res));

export const loadStory = (id: string): Promise<StoryDetail> =>
  fetch(`/api/stories/${encodeURIComponent(id)}`).then((res) => readJson<StoryDetail>(res));

export const saveStory = (
  id: string,
  input: { title?: string; worldview?: string },
): Promise<void> =>
  fetch(`/api/stories/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then(() => undefined);

export const deleteStory = (id: string): Promise<void> =>
  fetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => undefined);

export const addChapter = (storyId: string): Promise<{ id: string }> =>
  fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }).then((res) => readJson<{ id: string }>(res));

export const saveChapter = (
  storyId: string,
  chapterId: string,
  input: { title?: string; body?: string; narration?: string },
): Promise<void> =>
  fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then(() => undefined);

export const deleteChapter = (storyId: string, chapterId: string): Promise<void> =>
  fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`, {
    method: "DELETE",
  }).then(() => undefined);

export const reorderChapters = (storyId: string, ids: string[]): Promise<void> =>
  fetch(`/api/stories/${encodeURIComponent(storyId)}/chapters/reorder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  }).then(() => undefined);
