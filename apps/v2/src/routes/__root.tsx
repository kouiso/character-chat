import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import { AppErrorState, AppLoadingState, AppNotFoundState } from "../component/app-route-state";
import appCss from "../style.css?url";

const RootDocument = ({ children }: { children: React.ReactNode }) => (
  <html lang="ja">
    <head>
      <HeadContent />
    </head>
    <body>
      <div id="root">{children}</div>
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  pendingComponent: AppLoadingState,
  errorComponent: AppErrorState,
  notFoundComponent: AppNotFoundState,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#09090b" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: "adult-ai v2" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png" },
    ],
  }),
  shellComponent: RootDocument,
});
