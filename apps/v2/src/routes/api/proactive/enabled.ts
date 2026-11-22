// GET /api/proactive/enabled — キャラごとの話しかけ enabled 印の一覧。
// 通知の設定画面が「話しかけてくる子」のスイッチを描くのに使う。
import { createFileRoute } from "@tanstack/react-router";

import { handleProactiveEnabledList } from "../../../server/api-proactive";

export const Route = createFileRoute("/api/proactive/enabled")({
  server: {
    handlers: {
      GET: () => handleProactiveEnabledList(),
    },
  },
});
