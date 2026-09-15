import { describe, expect, it } from "vitest";

import { classifyChatUpstreamStatus, httpStatusForChatUpstreamErrorCode } from "../[[route]]";

describe("chat upstream error classification", () => {
  it("classifies upstream status into stable error codes", () => {
    expect(classifyChatUpstreamStatus(402)).toBe("credit_exhausted");
    expect(classifyChatUpstreamStatus(502)).toBe("upstream_unavailable");
    expect(classifyChatUpstreamStatus(503)).toBe("upstream_unavailable");
    expect(classifyChatUpstreamStatus(429)).toBe("upstream_unavailable");
    expect(classifyChatUpstreamStatus(504)).toBe("upstream_timeout");
    expect(classifyChatUpstreamStatus(408)).toBe("upstream_timeout");
    expect(classifyChatUpstreamStatus(undefined)).toBe("upstream_error");
  });

  it("maps stable error codes to user-facing HTTP status", () => {
    expect(httpStatusForChatUpstreamErrorCode("credit_exhausted")).toBe(402);
    expect(httpStatusForChatUpstreamErrorCode("upstream_unavailable")).toBe(502);
    expect(httpStatusForChatUpstreamErrorCode("upstream_timeout")).toBe(504);
  });
});
