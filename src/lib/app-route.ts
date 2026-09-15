import type { OuScreen } from "@/component/ouse/ouse-screen-types";

const LEGAL_ROUTES = {
  tos: "/legal/tos",
  tokushoho: "/legal/tokushoho",
  privacy: "/legal/privacy",
} as const;

export type LegalRoute = (typeof LEGAL_ROUTES)[keyof typeof LEGAL_ROUTES];

export type AppRoute =
  | { page: "home" }
  | { page: "discover" }
  | { page: "album" }
  | { page: "my" }
  | { page: "history" }
  | { page: "groups" }
  | { page: "create" }
  | { page: "assets" }
  | { page: "admin" }
  | { page: "chat"; characterId?: string; conversationId?: string; focusMessageId?: string }
  | { page: "character"; characterId?: string; characterSlug?: string }
  | { page: "group"; groupId: string }
  | { page: "share"; shareId: string; focusMessageId?: string }
  | { page: "legal"; route: LegalRoute }
  | { page: "not-found"; path: string };

export type AppPage = AppRoute["page"];

// URL に載る画面。scene/memory/edit は talk/my に重なる一時的なピッカーで、
// 閉じると直前の画面へ戻る性質のため URL には載せない。
export type RoutedScreen = Extract<
  OuScreen,
  "home" | "discover" | "photo" | "my" | "log" | "talk" | "utage" | "assets"
>;

type StaticPage = Extract<
  AppPage,
  | "home"
  | "discover"
  | "album"
  | "my"
  | "history"
  | "groups"
  | "create"
  | "chat"
  | "admin"
  | "assets"
>;

// 経路表の唯一の定義。パス→ルートもルート→パスもここだけから導出する。
const PATH_BY_STATIC_PAGE = {
  home: "/",
  discover: "/discover",
  album: "/album",
  my: "/my",
  history: "/history",
  groups: "/groups",
  create: "/create",
  assets: "/assets",
  chat: "/chat",
  admin: "/admin",
} as const satisfies Record<StaticPage, string>;

// 正典パスと同じ画面を指す旧形式。書き出しには使わず、受けたら正典側へ寄せる。
const STATIC_ALIASES: ReadonlyArray<readonly [string, AppRoute]> = [
  ["", { page: "home" }],
  ["/home", { page: "home" }],
  // Cloudflare Pages は /index.html を実在の静的資産として 200 で返すので、
  // ここへ直接来るとアプリは起動する。別名に入れておかんと、サーバは配信できたのに
  // クライアントだけ 404 を出すという食い違いになる。
  ["/index.html", { page: "home" }],
];

const ROUTE_BY_PATH = new Map<string, AppRoute>([
  ...(Object.keys(PATH_BY_STATIC_PAGE) as StaticPage[]).map((page): [string, AppRoute] => [
    PATH_BY_STATIC_PAGE[page],
    { page } as AppRoute,
  ]),
  ...STATIC_ALIASES.map(([path, route]): [string, AppRoute] => [path, route]),
  ...(Object.values(LEGAL_ROUTES) as LegalRoute[]).map((route): [string, AppRoute] => [
    route,
    { page: "legal", route },
  ]),
]);

// 画面 ⇄ ページの対応。character/create はシートを重ねる下地の画面を持つ。
const SCREEN_BY_PAGE = {
  home: "home",
  discover: "discover",
  album: "photo",
  my: "my",
  history: "log",
  chat: "talk",
  groups: "utage",
  character: "discover",
  create: "discover",
  assets: "assets",
} as const satisfies Partial<Record<AppPage, RoutedScreen>>;

const PAGE_BY_ROUTED_SCREEN = {
  home: "home",
  discover: "discover",
  photo: "album",
  my: "my",
  log: "history",
  talk: "chat",
  utage: "groups",
  assets: "assets",
} as const satisfies Record<RoutedScreen, StaticPage>;

export const isRoutedScreen = (screen: OuScreen): screen is RoutedScreen =>
  screen in PAGE_BY_ROUTED_SCREEN;

// このルートを OuApp が描画するとき、下地に出す画面。OuApp 管理外なら null。
export const screenForRoute = (route: AppRoute): RoutedScreen | null =>
  route.page in SCREEN_BY_PAGE ? SCREEN_BY_PAGE[route.page as keyof typeof SCREEN_BY_PAGE] : null;

export const pathForScreen = (screen: RoutedScreen): string =>
  PATH_BY_STATIC_PAGE[PAGE_BY_ROUTED_SCREEN[screen]];

const withQuery = (base: string, params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

const buildChatPath = (route: Extract<AppRoute, { page: "chat" }>): string => {
  const base = route.characterId
    ? `/chat/${encodeURIComponent(route.characterId)}`
    : PATH_BY_STATIC_PAGE.chat;
  const params = new URLSearchParams();
  if (route.conversationId) params.set("conv", route.conversationId);
  if (route.focusMessageId) params.set("m", route.focusMessageId);
  return withQuery(base, params);
};

const buildSharePath = (route: Extract<AppRoute, { page: "share" }>): string => {
  const params = new URLSearchParams();
  if (route.focusMessageId) params.set("m", route.focusMessageId);
  return withQuery(`/share/${encodeURIComponent(route.shareId)}`, params);
};

// ルートから URL 文字列を組み立てる。character は id 形式を正典とする。
export const buildPath = (route: AppRoute): string => {
  if (route.page === "chat") return buildChatPath(route);
  if (route.page === "share") return buildSharePath(route);
  if (route.page === "character") {
    return route.characterId
      ? `/characters/${encodeURIComponent(route.characterId)}`
      : `/c/${encodeURIComponent(route.characterSlug ?? "")}`;
  }
  if (route.page === "group") return `/groups/${encodeURIComponent(route.groupId)}`;
  if (route.page === "legal") return route.route;
  if (route.page === "not-found") return route.path;
  return PATH_BY_STATIC_PAGE[route.page];
};

type EntityParser = readonly [
  prefix: string,
  build: (id: string) => AppRoute,
  emptyIdRoute: AppRoute | null,
];

// 末尾に id を持つ経路。id が空のときは emptyIdRoute（null なら 404）へ落とす。
const ENTITY_PARSERS: readonly EntityParser[] = [
  ["/chat/", (characterId) => ({ page: "chat", characterId }), { page: "chat" }],
  ["/characters/", (characterId) => ({ page: "character", characterId }), null],
  ["/c/", (characterSlug) => ({ page: "character", characterSlug }), null],
  ["/groups/", (groupId) => ({ page: "group", groupId }), { page: "groups" }],
  ["/share/", (shareId) => ({ page: "share", shareId }), null],
];

const parseEntityPath = (pathPart: string): AppRoute | null => {
  for (const [prefix, build, emptyIdRoute] of ENTITY_PARSERS) {
    if (!pathPart.startsWith(prefix)) continue;
    const raw = pathPart.slice(prefix.length);
    if (!raw) return emptyIdRoute;
    // 壊れたパーセントエンコードは decodeURIComponent が投げる。404 として扱う。
    try {
      return build(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
};

const attachParams = (
  route: AppRoute,
  conversationId: string | undefined,
  focusMessageId: string | undefined,
): AppRoute => {
  if (route.page === "chat") {
    return {
      ...route,
      ...(conversationId ? { conversationId } : {}),
      ...(focusMessageId ? { focusMessageId } : {}),
    };
  }
  // 共有ビューの「特定の発言へのディープリンク」。shareId のパース規則と衝突させないため
  // messageId は path ではなく query(?m=)で受ける。
  if (route.page === "share" && focusMessageId) return { ...route, focusMessageId };
  return route;
};

// `pathname + search`（例: `/chat/char-1?conv=x`）を AppRoute に解析する。
// 旧ハッシュ形式(先頭 `#`)も後方互換で受ける。未知のパスは not-found にする。
export const parseRoute = (locationPath: string): AppRoute => {
  const normalized = locationPath.startsWith("#") ? locationPath.slice(1) : locationPath;
  const [pathPart, queryPart = ""] = normalized.split("?");
  const params = new URLSearchParams(queryPart);
  const conversationId = params.get("conv") ?? undefined;
  const focusMessageId = params.get("m") ?? undefined;

  const staticRoute = ROUTE_BY_PATH.get(pathPart);
  if (staticRoute) return attachParams(staticRoute, conversationId, focusMessageId);

  const entityRoute = parseEntityPath(pathPart);
  if (entityRoute) return attachParams(entityRoute, conversationId, focusMessageId);

  return { page: "not-found", path: pathPart };
};

export { LEGAL_ROUTES };
