// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleChatRequest } from "./api-chat";

const fixture = vi.hoisted(() => ({
  submit: vi.fn(),
  readEvents: vi.fn(),
  recordActivity: vi.fn(),
  getRecipient: vi.fn(),
  waitUntil: vi.fn(),
  background: [] as Promise<unknown>[],
}));
vi.mock("cloudflare:workers", () => ({ waitUntil: fixture.waitUntil }));
vi.mock("./engine", () => ({
  LOCAL_USER_ID: "synthetic-user",
  CharacterInvalidError: class extends Error {},
  CharacterNotFoundError: class extends Error {},
  ConversationNotFoundError: class extends Error {},
  loadRoomHistory: async () => ({ turn: 1, history: [] }),
  loadHistory: vi.fn(),
}));
vi.mock("./platform", () => ({
  getPlatform: async () => ({
    env: {
      CHAT_ROOMS: { getByName: () => ({ submit: fixture.submit, readEvents: fixture.readEvents }) },
      PROACTIVE_RECIPIENTS: { getByName: fixture.getRecipient },
    },
  }),
}));

const request = (requestId = "synthetic-request") =>
  new Request("https://local.invalid/api/chat/synthetic-character", {
    method: "POST",
    body: JSON.stringify({
      conversationId: "synthetic-conversation",
      requestId,
      text: "synthetic input",
    }),
  });

describe("accepted chat and optional activity recording (isolated RPC mocks)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixture.background.length = 0;
    fixture.submit.mockResolvedValue({ status: "accepted", requestId: "synthetic-request" });
    fixture.readEvents.mockResolvedValue({ events: [], status: "succeeded" });
    fixture.recordActivity.mockResolvedValue(undefined);
    fixture.getRecipient.mockReturnValue({ recordActivity: fixture.recordActivity });
    fixture.waitUntil.mockImplementation((promise: Promise<unknown>) => {
      fixture.background.push(promise);
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("streams an accepted reply even when the optional recipient repeatedly rejects", async () => {
    fixture.recordActivity.mockRejectedValue(new Error("synthetic private failure"));
    const response = await handleChatRequest("synthetic-character", request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain(": connected");
    await Promise.all(fixture.background);
    expect(fixture.recordActivity).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("proactive_activity_recording_failed");
    expect(fixture.submit).toHaveBeenCalledOnce();
  });

  it("does not hold the accepted response behind a hung RPC and bounds background waiting", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    fixture.recordActivity.mockImplementation(() => new Promise(() => undefined));
    const response = await handleChatRequest("synthetic-character", request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(": connected");
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all(fixture.background);
    expect(fixture.recordActivity).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith("proactive_activity_recording_failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries an ambiguous failure with the same activity identity", async () => {
    fixture.recordActivity
      .mockRejectedValueOnce(new Error("synthetic lost acknowledgement"))
      .mockResolvedValueOnce(undefined);
    expect((await handleChatRequest("synthetic-character", request())).status).toBe(200);
    await Promise.all(fixture.background);
    expect(fixture.recordActivity).toHaveBeenCalledTimes(2);
    const [first, second] = fixture.recordActivity.mock.calls;
    expect(first).toEqual(second);
    expect(first).toEqual(["synthetic-character", expect.stringMatching(/^[\da-f]{64}$/)]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("preserves the activity identity across reconnection and isolates another request", async () => {
    for (const id of ["synthetic-request", "synthetic-request", "synthetic-other"]) {
      fixture.submit.mockResolvedValueOnce({ status: "accepted", requestId: id });
      expect((await handleChatRequest("synthetic-character", request(id))).status).toBe(200);
      await Promise.all(fixture.background);
    }
    const identities = fixture.recordActivity.mock.calls.map((call) => call[1]);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[0]);
  });

  it("keeps the accepted response available when namespace lookup throws", async () => {
    fixture.getRecipient.mockImplementation(() => {
      throw new Error("synthetic namespace failure");
    });
    expect((await handleChatRequest("synthetic-character", request())).status).toBe(200);
    await Promise.all(fixture.background);
    expect(fixture.getRecipient).toHaveBeenCalledTimes(3);
    expect(fixture.recordActivity).not.toHaveBeenCalled();
  });

  it("does not record activity for a conflicting submission", async () => {
    fixture.submit.mockResolvedValue({ status: "conflict", requestId: "synthetic-request" });
    expect((await handleChatRequest("synthetic-character", request())).status).toBe(409);
    expect(fixture.waitUntil).not.toHaveBeenCalled();
    expect(fixture.getRecipient).not.toHaveBeenCalled();
  });

  it("does not turn an accepted request into503 when background registration throws", async () => {
    fixture.waitUntil.mockImplementation((promise: Promise<unknown>) => {
      fixture.background.push(promise);
      throw new Error("synthetic context failure");
    });
    expect((await handleChatRequest("synthetic-character", request())).status).toBe(200);
    await Promise.all(fixture.background);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "proactive_activity_background_unavailable",
    );
  });
});
