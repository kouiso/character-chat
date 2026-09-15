import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRoutePath,
  handleNavClick,
  migrateLegacyHash,
  type NavClickEvent,
  pushPath,
  replacePath,
  ROUTE_CHANGE_EVENT,
} from "./navigation";

const clickEvent = (overrides: Partial<NavClickEvent>): NavClickEvent => ({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault: () => {},
  ...overrides,
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRoutePath", () => {
  it("returns pathname and search", () => {
    window.history.replaceState(null, "", "/chat?conv=conv-1");
    expect(getRoutePath()).toBe("/chat?conv=conv-1");
  });
});

describe("pushPath", () => {
  it("pushes a new path and dispatches the route change event", () => {
    const listener = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, listener);
    pushPath("/discover");
    expect(getRoutePath()).toBe("/discover");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(ROUTE_CHANGE_EVENT, listener);
  });

  it("does nothing when the target equals the current path", () => {
    window.history.replaceState(null, "", "/my");
    const listener = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, listener);
    pushPath("/my");
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(ROUTE_CHANGE_EVENT, listener);
  });

  it("normalizes input without a leading slash", () => {
    pushPath("home");
    expect(getRoutePath()).toBe("/home");
  });
});

describe("replacePath", () => {
  it("replaces the current entry without adding history", () => {
    const before = window.history.length;
    replacePath("/album");
    expect(getRoutePath()).toBe("/album");
    expect(window.history.length).toBe(before);
  });
});

describe("migrateLegacyHash", () => {
  it("rewrites a legacy hash url to the equivalent path", () => {
    window.history.replaceState(null, "", "/#/chat?conv=conv-9");
    migrateLegacyHash();
    expect(getRoutePath()).toBe("/chat?conv=conv-9");
  });

  it("leaves non-hash urls untouched", () => {
    window.history.replaceState(null, "", "/discover");
    migrateLegacyHash();
    expect(getRoutePath()).toBe("/discover");
  });
});

describe("handleNavClick", () => {
  it("prevents default and navigates on a plain left click", () => {
    const preventDefault = vi.fn();
    handleNavClick("/history")(clickEvent({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(getRoutePath()).toBe("/history");
  });

  it("defers to browser default when a modifier key is held", () => {
    const preventDefault = vi.fn();
    handleNavClick("/history")(clickEvent({ metaKey: true, preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(getRoutePath()).toBe("/");
  });
});
