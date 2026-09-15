import "@testing-library/jest-dom/vitest";

// jsdom には実際の HTTP サーバが無い。useNetworkStatus が /api/health を ping しても
// オンライン判定が不定にならんよう、200 を返す最小 stub を置く。
// vi.fn で globalThis.fetch を置き換えると、テスト内の vi.spyOn(globalThis, "fetch")
// が同一 MockInstance を再利用して呼び出し履歴が累積するため、素の関数でラップする。
const originalFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input.toString();
  // useNetworkStatus が /api/health を ping してもオンライン判定が不定にならんよう 200 を返す。
  // 末尾一致・?以降は無視する。正規表現を避けて ReDoS リスクを潰す。
  const isHealth = url === "/api/health" || url.startsWith("/api/health?");
  if (isHealth) {
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }
  return originalFetch
    ? originalFetch(input, init)
    : Promise.reject(new Error("fetch not available"));
};

// ダウンロード用リンクの click は jsdom が未実装の画面遷移を予約して
// 別テストの実行中にエラーを出すため、ブラウザ外では遷移だけを止める。
if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLAnchorElement && target.hasAttribute("download")) {
      event.preventDefault();
    }
  });
}

const needsLocalStorageShim =
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.clear !== "function";

if (needsLocalStorageShim) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}
