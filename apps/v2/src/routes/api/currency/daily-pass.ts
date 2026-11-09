// /api/currency/daily-pass — 1日券（24h 機能解放）。POST=購入・GET=状態（RIT-194）。
import { createFileRoute } from "@tanstack/react-router";

import {
  handleDailyPassActivateRequest,
  handleDailyPassStatusRequest,
} from "../../../server/api-retention";

export const Route = createFileRoute("/api/currency/daily-pass")({
  server: {
    handlers: {
      GET: () => handleDailyPassStatusRequest(),
      POST: () => handleDailyPassActivateRequest(),
    },
  },
});
