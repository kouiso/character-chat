// ストーリー詳細・章エディタ（RIT-214）。世界観/タイトル編集＋章の追加・編集・並び替え。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";

import {
  addChapter,
  deleteChapter,
  deleteStory,
  loadStory,
  reorderChapters,
  saveChapter,
  saveStory,
  type StoryChapter,
  type StoryDetail,
} from "../../lib/stories";
import { getStory } from "../../server/stories";

const routeApi = getRouteApi("/stories/$id");

// ローダ値の初期フォーム値。分岐はここに寄せてページ本体を平たく保つ。
const formFields = (story: StoryDetail | null) => ({
  title: story?.title ?? "",
  worldview: story?.worldview ?? "",
  chapterId: story?.chapters[0]?.id ?? null,
});

// confirm() 禁止のため2段階ボタンで代替する。
const ConfirmButton = ({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) => {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className="v2-danger"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
};

const ChapterList = ({
  chapters,
  selectedId,
  busy,
  onSelect,
  onMove,
}: {
  chapters: StoryChapter[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
}) => (
  <ol>
    {chapters.map((c, i) => (
      <li key={c.id}>
        <button
          type="button"
          className={c.id === selectedId ? "v2-chapter-current" : ""}
          onClick={() => onSelect(c.id)}
        >
          {i + 1}. {c.title || "無題"}
        </button>
        <button type="button" disabled={busy || i === 0} onClick={() => onMove(i, i - 1)}>
          ↑
        </button>
        <button
          type="button"
          disabled={busy || i === chapters.length - 1}
          onClick={() => onMove(i, i + 1)}
        >
          ↓
        </button>
      </li>
    ))}
  </ol>
);

const ChapterEditor = ({
  storyId,
  chapter,
  onSaved,
  onDeleted,
}: {
  storyId: string;
  chapter: StoryChapter;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) => {
  const [title, setTitle] = useState(chapter.title);
  const [body, setBody] = useState(chapter.body);
  const [narration, setNarration] = useState(chapter.narration);
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    void saveChapter(storyId, chapter.id, { title, body, narration })
      .then(onSaved)
      .finally(() => setBusy(false));
  };
  return (
    <section className="v2-chapter-editor">
      <h3>第{chapter.ord + 1}章</h3>
      <label>
        章タイトル
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label>
        本文
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
      </label>
      <label>
        ナレーション
        <textarea value={narration} onChange={(e) => setNarration(e.target.value)} rows={3} />
      </label>
      <button type="button" disabled={busy} onClick={save}>
        章を保存
      </button>
      <ConfirmButton
        label="章を削除"
        confirmLabel="本当に削除"
        onConfirm={() => void deleteChapter(storyId, chapter.id).then(onDeleted)}
      />
    </section>
  );
};

const StoryEditorPage = () => {
  const { id } = routeApi.useParams();
  const navigate = useNavigate();
  const initial = routeApi.useLoaderData();
  const [story, setStory] = useState<StoryDetail | null>(initial);
  const [title, setTitle] = useState(formFields(initial).title);
  const [worldview, setWorldview] = useState(formFields(initial).worldview);
  const [selectedId, setSelectedId] = useState<string | null>(formFields(initial).chapterId);
  const [busy, setBusy] = useState(false);

  const reload = async () => setStory(await loadStory(id));
  const chapters = story?.chapters ?? [];
  const selected: StoryChapter | undefined = chapters.find((c) => c.id === selectedId);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    withBusy(async () => {
      const { id: cid } = await addChapter(id);
      await reload();
      setSelectedId(cid);
    });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chapters.length) return;
    const ids = chapters.map((c) => c.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    void withBusy(async () => {
      await reorderChapters(id, ids);
      await reload();
    });
  };

  if (!story) return <p>ストーリーが見つかりません。</p>;
  return (
    <div className="v2-list v2-story-editor">
      <h1>ストーリー編集</h1>
      <Link to="/stories">一覧へ戻る</Link>
      <label>
        タイトル
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label>
        世界観
        <textarea value={worldview} onChange={(e) => setWorldview(e.target.value)} rows={3} />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void withBusy(async () => saveStory(id, { title, worldview }).then(reload))}
      >
        保存
      </button>
      <ConfirmButton
        label="削除"
        confirmLabel="本当に削除"
        onConfirm={() => void deleteStory(id).then(() => navigate({ to: "/stories" }))}
      />
      <section className="v2-chapters">
        <h2>章</h2>
        <button type="button" disabled={busy} onClick={() => void add()}>
          章を追加
        </button>
        <ChapterList
          chapters={chapters}
          selectedId={selectedId}
          busy={busy}
          onSelect={setSelectedId}
          onMove={move}
        />
      </section>
      {selected && (
        <ChapterEditor
          key={selected.id}
          storyId={id}
          chapter={selected}
          onSaved={reload}
          onDeleted={() => {
            setSelectedId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};

export const Route = createFileRoute("/stories/$id")({
  loader: async ({ params }) => getStory({ data: params.id }),
  component: StoryEditorPage,
});
