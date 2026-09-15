import { describe, expect, it } from "vitest";

import {
  buildPath,
  isRoutedScreen,
  parseRoute,
  pathForScreen,
  screenForRoute,
  type AppRoute,
  type RoutedScreen,
} from "./app-route";

// 経路表の全経路。1 行 = 1 パス = 1 ルート = 1 画面。
const PATH_TABLE: ReadonlyArray<{
  path: string;
  route: AppRoute;
  screen: RoutedScreen | null;
}> = [
  { path: "/", route: { page: "home" }, screen: "home" },
  { path: "/discover", route: { page: "discover" }, screen: "discover" },
  { path: "/album", route: { page: "album" }, screen: "photo" },
  { path: "/my", route: { page: "my" }, screen: "my" },
  { path: "/history", route: { page: "history" }, screen: "log" },
  { path: "/groups", route: { page: "groups" }, screen: "utage" },
  { path: "/create", route: { page: "create" }, screen: "discover" },
  { path: "/chat", route: { page: "chat" }, screen: "talk" },
  { path: "/admin", route: { page: "admin" }, screen: null },
  {
    path: "/chat/char-1",
    route: { page: "chat", characterId: "char-1" },
    screen: "talk",
  },
  {
    path: "/characters/char-1",
    route: { page: "character", characterId: "char-1" },
    screen: "discover",
  },
  {
    path: "/c/misaki",
    route: { page: "character", characterSlug: "misaki" },
    screen: "discover",
  },
  { path: "/groups/g-1", route: { page: "group", groupId: "g-1" }, screen: null },
  { path: "/share/s-1", route: { page: "share", shareId: "s-1" }, screen: null },
  { path: "/legal/tos", route: { page: "legal", route: "/legal/tos" }, screen: null },
  {
    path: "/legal/tokushoho",
    route: { page: "legal", route: "/legal/tokushoho" },
    screen: null,
  },
  { path: "/legal/privacy", route: { page: "legal", route: "/legal/privacy" }, screen: null },
];

describe("path table", () => {
  it.each(PATH_TABLE)("parses $path", ({ path, route }) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it.each(PATH_TABLE)("builds $path back from its route", ({ path, route }) => {
    expect(buildPath(route)).toBe(path);
  });

  it.each(PATH_TABLE)("maps $path to its screen", ({ path, screen }) => {
    expect(screenForRoute(parseRoute(path))).toBe(screen);
  });

  it.each(PATH_TABLE)("accepts the legacy hash form of $path", ({ path, route }) => {
    expect(parseRoute(`#${path}`)).toEqual(route);
  });
});

describe("parseRoute: unknown paths render 404 instead of falling to home", () => {
  it.each(["/nope", "/support", "/pricing", "/legal", "/legal/unknown", "/album/extra"])(
    "resolves %s to not-found",
    (path) => {
      expect(parseRoute(path)).toEqual({ page: "not-found", path });
    },
  );

  it("resolves an empty character id to not-found", () => {
    expect(parseRoute("/characters/")).toEqual({ page: "not-found", path: "/characters/" });
  });

  it("resolves an empty slug to not-found", () => {
    expect(parseRoute("/c/")).toEqual({ page: "not-found", path: "/c/" });
  });

  it("resolves an empty share id to not-found", () => {
    expect(parseRoute("/share/")).toEqual({ page: "not-found", path: "/share/" });
  });

  it("resolves a broken percent-encoding to not-found", () => {
    expect(parseRoute("/chat/%E0%A4%A")).toEqual({ page: "not-found", path: "/chat/%E0%A4%A" });
  });

  it("keeps the unknown path so the 404 screen can show it", () => {
    expect(parseRoute("/nope?conv=x")).toEqual({ page: "not-found", path: "/nope" });
  });
});

describe("parseRoute: home aliases", () => {
  // /index.html は Cloudflare Pages が実在の静的資産として 200 で返す唯一のパスなので、
  // 404 にするとサーバは配信できたのにクライアントだけ「無い」と言う状態になる。
  it.each(["", "/home", "/index.html"])("resolves %s to home", (path) => {
    expect(parseRoute(path)).toEqual({ page: "home" });
  });

  it.each(["/home", "/index.html"])("normalises the alias %s to / when building", (path) => {
    expect(buildPath(parseRoute(path))).toBe("/");
  });
});

describe("parseRoute: chat character id round-trip", () => {
  it("keeps the character id from the path", () => {
    expect(parseRoute("/chat/char-1")).toEqual({ page: "chat", characterId: "char-1" });
  });

  it("keeps the character id alongside a conversation id", () => {
    expect(parseRoute("/chat/char-1?conv=conv-42")).toEqual({
      page: "chat",
      characterId: "char-1",
      conversationId: "conv-42",
    });
  });

  it("decodes encoded character ids", () => {
    expect(parseRoute("/chat/char%2Fspecial?conv=conv-1")).toEqual({
      page: "chat",
      characterId: "char/special",
      conversationId: "conv-1",
    });
  });

  it("round-trips character id, conversation id and focus message id", () => {
    const route: AppRoute = {
      page: "chat",
      characterId: "char/1",
      conversationId: "conv/2",
      focusMessageId: "msg 3",
    };
    expect(parseRoute(buildPath(route))).toEqual(route);
  });

  it("keeps the conversation id on the plain chat path", () => {
    expect(parseRoute("/chat?conv=conv-99")).toEqual({ page: "chat", conversationId: "conv-99" });
  });

  it("resolves /chat/ with an empty id to the plain chat route", () => {
    expect(parseRoute("/chat/")).toEqual({ page: "chat" });
  });
});

describe("parseRoute: character detail", () => {
  it("resolves /characters/:id", () => {
    expect(parseRoute("/characters/abc-123")).toEqual({
      page: "character",
      characterId: "abc-123",
    });
  });

  it("resolves /c/:slug", () => {
    expect(parseRoute("/c/美咲")).toEqual({ page: "character", characterSlug: "美咲" });
  });

  it("decodes an encoded slug", () => {
    expect(parseRoute("/c/%E7%BE%8E%E5%92%B2")).toEqual({
      page: "character",
      characterSlug: "美咲",
    });
  });

  it("builds the canonical id form whenever an id is known", () => {
    expect(buildPath({ page: "character", characterId: "abc-123", characterSlug: "misaki" })).toBe(
      "/characters/abc-123",
    );
  });
});

describe("parseRoute: share deep links", () => {
  it("decodes encoded share ids", () => {
    expect(parseRoute("/share/abc%2Fdef")).toEqual({ page: "share", shareId: "abc/def" });
  });

  it("parses ?m=<messageId> as focusMessageId", () => {
    expect(parseRoute("/share/share-1?m=msg-2")).toEqual({
      page: "share",
      shareId: "share-1",
      focusMessageId: "msg-2",
    });
  });

  it("omits focusMessageId when ?m= is absent", () => {
    expect(parseRoute("/share/share-1")).toEqual({ page: "share", shareId: "share-1" });
  });

  it("accepts the legacy hash form with a focus message id", () => {
    expect(parseRoute("#/share/share-1?m=msg-2")).toEqual({
      page: "share",
      shareId: "share-1",
      focusMessageId: "msg-2",
    });
  });
});

describe("screen ⇄ path", () => {
  const routedScreens: RoutedScreen[] = ["home", "discover", "photo", "my", "log", "talk", "utage"];

  it.each(routedScreens)("round-trips the %s screen through its path", (screen) => {
    expect(screenForRoute(parseRoute(pathForScreen(screen)))).toBe(screen);
  });

  it.each(routedScreens)("treats %s as a routed screen", (screen) => {
    expect(isRoutedScreen(screen)).toBe(true);
  });

  it.each(["scene", "memory", "edit"] as const)("treats %s as a non-routed overlay", (screen) => {
    expect(isRoutedScreen(screen)).toBe(false);
  });
});
