import { act } from "react";

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentVisible } from "./use-document-visible";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("useDocumentVisible", () => {
  it("前面なら true", () => {
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);
  });

  it("背面へ回ったら false、戻ったら true", () => {
    const { result } = renderHook(() => useDocumentVisible());
    act(() => setVisibility("hidden"));
    expect(result.current).toBe(false);
    act(() => setVisibility("visible"));
    expect(result.current).toBe(true);
  });
});
