import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createLogger, addLogSink, type LogEntry } from "./logger";

describe("createLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("コンソールに [ns] message 形式で出力する", () => {
    const logger = createLogger("quality");
    logger.info("claude-judge running");
    expect(console.info).toHaveBeenCalledWith("[quality] claude-judge running");
  });

  it("data が渡された場合は第2引数に含める", () => {
    const logger = createLogger("api");
    logger.warn("stream error", { status: 502 });
    expect(console.warn).toHaveBeenCalledWith("[api] stream error", { status: 502 });
  });

  it("warn / error は対応する console メソッドを呼ぶ", () => {
    const logger = createLogger("settings");
    logger.warn("quota exceeded");
    logger.error("fatal error");
    expect(console.warn).toHaveBeenCalledWith("[settings] quota exceeded");
    expect(console.error).toHaveBeenCalledWith("[settings] fatal error");
  });

  it("debug はコンソール出力しない", () => {
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = createLogger("internal");
    logger.debug("verbose trace");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });
});

describe("addLogSink", () => {
  it("sink に LogEntry が届く", () => {
    const entries: LogEntry[] = [];
    const remove = addLogSink((e) => entries.push(e));

    const logger = createLogger("quality");
    logger.warn("judge skipped");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      ns: "quality",
      msg: "judge skipped",
    });
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    remove();
  });

  it("debug も sink には届く", () => {
    const entries: LogEntry[] = [];
    const remove = addLogSink((e) => entries.push(e));

    createLogger("internal").debug("trace", { x: 1 });

    expect(entries[0]).toMatchObject({ level: "debug", ns: "internal", data: { x: 1 } });
    remove();
  });

  it("sink が throw しても caller に伝播しない", () => {
    const remove = addLogSink(() => {
      throw new Error("sink crash");
    });
    expect(() => createLogger("test").info("safe")).not.toThrow();
    remove();
  });

  it("remove() で sink が解除される", () => {
    const entries: LogEntry[] = [];
    const remove = addLogSink((e) => entries.push(e));
    remove();

    createLogger("test").info("after remove");
    expect(entries).toHaveLength(0);
  });
});
