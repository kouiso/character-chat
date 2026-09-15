import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import {
  isDisplayableImageUrl,
  pickDisplaySrc,
  shouldAuthenticate,
  useAuthenticatedImageUrl,
} from "./authenticated-image";

beforeEach(() => {
  apiFetchMock.mockReset();
  // URL.createObjectURL / revokeObjectURL は jsdom に未実装なため stub する。
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:mock"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("shouldAuthenticate", () => {
  it("flags same-origin protected paths only", () => {
    expect(shouldAuthenticate("/api/image/r2/images/x.jpg")).toBe(true);
    expect(shouldAuthenticate("/avatars/char-a.jpg")).toBe(true);
    expect(shouldAuthenticate("https://image.novita.ai/x.png")).toBe(false);
    expect(shouldAuthenticate("data:image/png;base64,aaa")).toBe(false);
  });
});

describe("isDisplayableImageUrl", () => {
  it("allows auth paths, data/blob, and allowlisted https hosts", () => {
    expect(isDisplayableImageUrl("/api/avatar/x.jpg")).toBe(true);
    expect(isDisplayableImageUrl("/avatars/x.jpg")).toBe(true);
    expect(isDisplayableImageUrl("data:image/png;base64,aaa")).toBe(true);
    expect(isDisplayableImageUrl("blob:https://x/y")).toBe(true);
    expect(isDisplayableImageUrl("https://image.novita.ai/x.png")).toBe(true);
  });

  it("rejects disallowed hosts, non-https, and garbage", () => {
    expect(isDisplayableImageUrl("https://evil.example.com/x.png")).toBe(false);
    expect(isDisplayableImageUrl("http://image.novita.ai/x.png")).toBe(false);
    expect(isDisplayableImageUrl("not a url")).toBe(false);
  });
});

describe("pickDisplaySrc", () => {
  it("returns null when unresolved", () => {
    expect(pickDisplaySrc(null, null)).toBeNull();
  });

  it("returns the blob url for auth paths, or null while pending", () => {
    expect(pickDisplaySrc("/api/image/r2/images/x.jpg", "blob:mock")).toBe("blob:mock");
    expect(pickDisplaySrc("/api/image/r2/images/x.jpg", null)).toBeNull();
    expect(pickDisplaySrc("/avatars/x.jpg", "blob:mock")).toBe("blob:mock");
  });

  it("passes through allowlisted external urls and blocks others", () => {
    expect(pickDisplaySrc("https://image.novita.ai/x.png", null)).toBe(
      "https://image.novita.ai/x.png",
    );
    expect(pickDisplaySrc("https://evil.example.com/x.png", null)).toBeNull();
  });
});

describe("useAuthenticatedImageUrl", () => {
  it("returns non-auth urls unchanged without fetching", () => {
    const { result } = renderHook(() => useAuthenticatedImageUrl("https://image.novita.ai/x.png"));
    expect(result.current).toEqual({ url: "https://image.novita.ai/x.png", failed: false });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("resolves auth paths to a blob object url with a Bearer-carrying apiFetch", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) });
    const { result } = renderHook(() => useAuthenticatedImageUrl("/api/image/r2/images/x.jpg"));
    expect(result.current.url).toBeNull();
    await waitFor(() => expect(result.current.url).toBe("blob:mock"));
    expect(result.current.failed).toBe(false);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/image/r2/images/x.jpg");
  });

  it("marks failed when the fetch is not ok", async () => {
    apiFetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useAuthenticatedImageUrl("/avatars/x.jpg"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.url).toBeNull();
  });

  it("marks failed when the fetch rejects", async () => {
    apiFetchMock.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useAuthenticatedImageUrl("/api/avatar/x.jpg"));
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it("revokes its object url on unmount", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) });
    const { result, unmount } = renderHook(() =>
      useAuthenticatedImageUrl("/api/image/r2/images/revoke.jpg"),
    );
    await waitFor(() => expect(result.current.url).toBe("blob:mock"));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("retries when auth token changes after a failure", async () => {
    let fail = true;
    apiFetchMock.mockImplementation(() => {
      if (fail) {
        fail = false;
        return Promise.resolve({ ok: false });
      }
      return Promise.resolve({ ok: true, blob: async () => new Blob(["x"]) });
    });
    const { result } = renderHook(() => useAuthenticatedImageUrl("/api/avatar/x.jpg"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    window.dispatchEvent(new CustomEvent("auth-token-changed"));
    await waitFor(() => expect(result.current.url).toBe("blob:mock"));
    expect(result.current.failed).toBe(false);
  });
});
