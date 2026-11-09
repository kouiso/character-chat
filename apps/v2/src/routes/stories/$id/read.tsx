// ストーリー・ビューア（RIT-215）。章→挿絵→ナレーション→本文の順で読み進める。
import { useState } from "react";

import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";

import { getStory } from "../../../server/stories";

const routeApi = getRouteApi("/stories/$id/read");

const StoryReaderPage = () => {
  const { id } = routeApi.useParams();
  const story = routeApi.useLoaderData();
  const [index, setIndex] = useState(0);
  if (!story || story.chapters.length === 0) {
    return (
      <div className="v2-list">
        <Link to="/stories/$id" params={{ id }}>
          編集へ戻る
        </Link>
        <p>章がありません。</p>
      </div>
    );
  }
  const chapter = story.chapters[Math.min(index, story.chapters.length - 1)];
  return (
    <div className="v2-reader">
      <header className="v2-reader-nav">
        <Link to="/stories/$id" params={{ id }}>
          編集へ戻る
        </Link>
        <span>
          {index + 1} / {story.chapters.length}
        </span>
      </header>
      <h1>
        {story.title} — 第{chapter.ord + 1}章 {chapter.title}
      </h1>
      {chapter.imageKey && (
        <img
          className="v2-reader-illustration"
          src={`/api/chapter-media/${encodeURIComponent(chapter.id)}`}
          alt={`第${chapter.ord + 1}章の挿絵`}
        />
      )}
      {chapter.narration && <p className="v2-reader-narration">{chapter.narration}</p>}
      <div className="v2-reader-body">
        {chapter.body.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <footer className="v2-reader-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          前の章
        </button>
        <button
          type="button"
          disabled={index >= story.chapters.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          次の章
        </button>
      </footer>
    </div>
  );
};

export const Route = createFileRoute("/stories/$id/read")({
  loader: async ({ params }) => getStory({ data: params.id }),
  component: StoryReaderPage,
});
