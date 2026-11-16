import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// cloudflare:workers は Vitest では解決できんので全試験へ既定の身代わりを置く。
// waitUntil・DurableObject・env の形が要る試験は各ファイルの vi.mock が上書きする。
vi.mock("cloudflare:workers", () => ({
  waitUntil: () => undefined,
  env: {},
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// Node 25 以降は globalThis.localStorage がメソッド無しの入れ物だけ先に存在し、
// jsdom の Storage を隠してしまう（localStorage.setItem is not a function）。
// 試験は Storage の振る舞いだけ見ればよいので、実装が無ければ差し替える。
const hasSetItem = (value: unknown): value is Storage =>
  typeof value === "object" &&
  value !== null &&
  "setItem" in value &&
  typeof value.setItem === "function";

if (!hasSetItem(Reflect.get(globalThis, "localStorage"))) {
  const jsdomWindow: unknown = Reflect.get(globalThis, "window");
  const fromJsdom: unknown =
    typeof jsdomWindow === "object" && jsdomWindow !== null
      ? Reflect.get(jsdomWindow, "localStorage")
      : undefined;
  const memory = (() => {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => void data.set(key, String(value)),
    } satisfies Storage;
  })();
  Object.defineProperty(globalThis, "localStorage", {
    value: hasSetItem(fromJsdom) ? fromJsdom : memory,
    configurable: true,
    writable: true,
  });
}
