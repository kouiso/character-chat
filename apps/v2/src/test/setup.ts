import "@testing-library/jest-dom/vitest";

// Node 25 以降は globalThis.localStorage がメソッド無しの入れ物だけ先に存在し、
// jsdom の Storage を隠してしまう（localStorage.setItem is not a function）。
// 試験は Storage の振る舞いだけ見ればよいので、実装が無ければ差し替える。
const storageLike = (globalThis as { localStorage?: unknown }).localStorage;
if (typeof (storageLike as Storage | undefined)?.setItem !== "function") {
  const fromJsdom = (globalThis as { window?: Window }).window?.localStorage;
  const memory = (() => {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => void data.set(key, String(value)),
    } satisfies Storage;
  })();
  Object.defineProperty(globalThis, "localStorage", {
    value: fromJsdom && typeof fromJsdom.setItem === "function" ? fromJsdom : memory,
    configurable: true,
    writable: true,
  });
}
