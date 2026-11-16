import { createFileRoute } from "@tanstack/react-router";

// 下タブ「マイ」の行き先。画面本体（My ボード）は別単位で作る
const MyPage = () => (
  <main className="v2-list">
    <h1>マイ</h1>
  </main>
);

export const Route = createFileRoute("/my")({ component: MyPage });
