import { createFileRoute } from "@tanstack/react-router";

// 下タブ「アルバム」の行き先。画面本体（Album ボード）は別単位で作る
const AlbumPage = () => (
  <main className="v2-list">
    <h1>アルバム</h1>
  </main>
);

export const Route = createFileRoute("/album")({ component: AlbumPage });
