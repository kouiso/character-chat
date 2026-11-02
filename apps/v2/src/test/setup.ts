import "@testing-library/jest-dom/vitest";

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
