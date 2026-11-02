import { createFileRoute } from "@tanstack/react-router";

import { getPlatform } from "../../server/platform";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { env } = await getPlatform();
        return Response.json({
          runtime: "workerd",
          environment: env.APP_ENV,
          mockModel: env.APP_ENV === "test" && env.V2_FAKE_MODEL === "1",
          testFault: env.APP_ENV === "test" ? env.V2_TEST_FAULT : "disabled",
        });
      },
    },
  },
});
