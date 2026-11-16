import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import { AppErrorState, AppLoadingState, AppNotFoundState } from "../component/app-route-state";
import { AppTabBar } from "../component/app-tab-bar";
import appCss from "../style.css?url";
import tokenCss from "../design-token.css?url";

const RootDocument = ({ children }: { children: React.ReactNode }) => (
  <html lang="ja">
    <head>
      <HeadContent />
    </head>
    <body>
      <div id="root">{children}</div>
      <AppTabBar />
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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#10162a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: "adult-ai v2" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=Zen+Maru+Gothic:wght@900&display=swap",
      },
      { rel: "stylesheet", href: tokenCss },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png" },
    ],
  }),
  shellComponent: RootDocument,
});
