import { StrictMode } from "react";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNetworkStatus } from "./use-network-status";

const setOnLine = (value: boolean) => {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
};

// signal.abort を尊重する fetch stub。abort されるまで解決せん ping を作れる。
const hangingFetch = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });

const okResponse = () => Promise.resolve(new Response("{}", { status: 200 }));

describe("useNetworkStatus", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
    setOnLine(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    setOnLine(true);
  });

  it("冷えた起動で初回 ping だけが時間切れになっても切断扱いにせん", async () => {
    let call = 0;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      // 起動直後はバンドル取得やフォント読み込みと競合して初回 ping が詰まる。
      return call === 1 ? hangingFetch(init) : okResponse();
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toBe(true);

    // 初回 ping の timeout(3s)。ここで false になるとバナーが出てしまう。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(result.current).toBe(true);

    // 次の巡回(5s)で疎通が取れる。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current).toBe(true);
  });

  // 起動直後の再マウント(StrictMode の二重呼び出し・Fast Refresh)で捨てたはずの ping が
  // 生き返り、1回きりの時間切れが「連続2回」に化けてバナーが出た事故の再発防止。
  // 集計を effect のローカルに閉じ込めんとここが赤くなる。
  it("起動直後に effect を張り直しても、1回分の失敗を連続失敗として数えん", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      hangingFetch(init)) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus(), { wrapper: StrictMode });

    // まだ1巡目の時間切れしか起きてへん時刻。ここで false ならバナーが誤って出る。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(result.current).toBe(true);
  });

  // 「つなぎ直しています…」はつなぎ直す先がある時の文言。一度も疎通できてへん起動直後は
  // 「まだ繋がっとらん」であって「切れた」やない。
  it("一度も疎通が取れてへんうちは、何回失敗しても切断扱いにせん", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      hangingFetch(init)) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current).toBe(true);
  });

  it("疎通できた後に続けて取れんくなったら切断として出す", async () => {
    let call = 0;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      // 1回目で疎通実績を作り、その後は落とす。
      return call === 1 ? okResponse() : hangingFetch(init);
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(true);

    // 2巡目(5s起点)の時間切れ 8s。まだ連続1回なので出さん。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    expect(result.current).toBe(true);

    // 3巡目(10s起点)の時間切れ 13s で連続2回。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current).toBe(false);
  });

  it("ブラウザの offline イベントは1回で切断として扱う", async () => {
    globalThis.fetch = (() => okResponse()) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus());

    // 初回 ping を先に決着させてから切断イベントを起こす。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);
  });

  it("疎通実績が無くてもブラウザの offline 宣言は信じる", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      hangingFetch(init)) as typeof globalThis.fetch;

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);
  });
});
