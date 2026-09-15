import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "adult-ai v2" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});
