type MiddlewareEnv = Record<string, never>;

const isApiPath = (pathname: string): boolean =>
  pathname === "/api" || pathname.startsWith("/api/");

// 公開シェルまで認証するとデプロイの疎通確認もアプリの起動も不可能になるため、
// 本人確認は各 API ハンドラにだけ委ねる。
export const onRequest: PagesFunction<MiddlewareEnv> = async ({ request, next }) => {
  const { pathname } = new URL(request.url);

  if (isApiPath(pathname)) return next();
  if (request.method === "GET" || request.method === "HEAD") return next();

  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });
};
