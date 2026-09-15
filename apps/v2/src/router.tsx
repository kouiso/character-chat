import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

// TanStack Start がサーバ/クライアント両方でこの関数を呼ぶ（router.tsx の getRouter export は規約）。
export const getRouter = () => createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
