import type { JSX } from "react";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

// Suppress console.error noise from intentional throws in tests.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary (regression: #411 back-button crash -> blank PWA)", () => {
  it("renders children normally when there is no error", () => {
    render(
      <ErrorBoundary>
        <p>hello</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("renders error fallback when a child throws (prevents blank PWA screen)", () => {
    const Broken = (): JSX.Element => {
      throw new Error("test render error");
    };
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("エラーが発生しました")).toBeDefined();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeDefined();
  });
});
