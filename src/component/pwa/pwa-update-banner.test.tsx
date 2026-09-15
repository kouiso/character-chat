import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/store/chat-store";

import { PwaUpdateBanner } from "./pwa-update-banner";

interface RegisterSwOptions {
  onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void;
}

const swMock = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn<() => Promise<void>>(),
  registrationUpdate: vi.fn<() => Promise<void>>(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: vi.fn((options: RegisterSwOptions = {}) => {
    options.onRegisteredSW?.("/sw.js", {
      update: swMock.registrationUpdate,
    } as unknown as ServiceWorkerRegistration);
    return {
      needRefresh: [swMock.needRefresh, vi.fn()],
      updateServiceWorker: swMock.updateServiceWorker,
    };
  }),
}));

beforeEach(() => {
  swMock.needRefresh = false;
  swMock.updateServiceWorker.mockReset();
  swMock.updateServiceWorker.mockResolvedValue(undefined);
  swMock.registrationUpdate.mockReset();
  swMock.registrationUpdate.mockResolvedValue(undefined);
  sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  useChatStore.setState({ isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PwaUpdateBanner", () => {
  it("needRefresh=false なら何も表示しない", () => {
    render(<PwaUpdateBanner />);

    expect(screen.queryByText("アプリが更新されました")).not.toBeInTheDocument();
  });

  it("needRefresh=true かつ isLoading=true なら更新ボタンを無効化する", () => {
    swMock.needRefresh = true;
    useChatStore.setState({ isLoading: true });

    render(<PwaUpdateBanner />);

    const button = screen.getByRole("button", { name: "配信中..." });
    expect(screen.getByText("アプリが更新されました")).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "配信完了後に更新できます");
    expect(swMock.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("needRefresh=true かつ isLoading=false なら更新ボタンを有効化する", () => {
    swMock.needRefresh = true;

    render(<PwaUpdateBanner />);

    const button = screen.getByRole("button", { name: "今すぐ更新" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title");
    expect(swMock.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("ユーザーが更新ボタンを押したときだけ Service Worker 更新を適用する", async () => {
    swMock.needRefresh = true;

    render(<PwaUpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "今すぐ更新" }));

    await waitFor(() => expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it("更新適用に失敗した場合は再試行できる", async () => {
    swMock.needRefresh = true;
    swMock.updateServiceWorker
      .mockRejectedValueOnce(new Error("update failed"))
      .mockResolvedValueOnce(undefined);

    render(<PwaUpdateBanner />);
    const button = screen.getByRole("button", { name: "今すぐ更新" });

    fireEvent.click(button);
    await waitFor(() => expect(swMock.updateServiceWorker).toHaveBeenCalledTimes(1));

    fireEvent.click(button);
    await waitFor(() => expect(swMock.updateServiceWorker).toHaveBeenCalledTimes(2));
  });

  it("document.hidden になると即時 Service Worker 更新を適用する", async () => {
    swMock.needRefresh = true;

    render(<PwaUpdateBanner />);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it("表示中でも60秒経過で自動的に Service Worker 更新を適用する", async () => {
    vi.useFakeTimers();
    swMock.needRefresh = true;

    render(<PwaUpdateBanner />);

    expect(swMock.updateServiceWorker).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("isLoading=true 中は自動適用せず、配信終了後に60秒以内で適用する", async () => {
    vi.useFakeTimers();
    swMock.needRefresh = true;
    useChatStore.setState({ isLoading: true });

    render(<PwaUpdateBanner />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(swMock.updateServiceWorker).not.toHaveBeenCalled();

    act(() => {
      useChatStore.setState({ isLoading: false });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(swMock.updateServiceWorker).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(swMock.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("登録時に update() を即時実行し、その後60秒周期で実行する", async () => {
    vi.useFakeTimers();

    render(<PwaUpdateBanner />);

    expect(swMock.registrationUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(swMock.registrationUpdate).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(swMock.registrationUpdate).toHaveBeenCalledTimes(3);
  });
});
