// POST /api/currency/login-bonus — 1日1回のログイン特典を受け取る（RIT-194）。
import { createFileRoute } from "@tanstack/react-router";

import { handleLoginBonusRequest } from "../../../server/api-retention";

export const Route = createFileRoute("/api/currency/login-bonus")({
  server: {
    handlers: {
      POST: () => handleLoginBonusRequest(),
    },
  },
});
