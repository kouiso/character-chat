import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  __testOnly,
  createQualityIssue,
  redactPII,
  shouldReportQualityIssue,
} from "../lib/quality-report";

describe("redactPII", () => {
  it("redacts email, phone, and URL paths", () => {
    const input =
      "mail me at a@example.com call +1-202-555-0199 and visit https://example.com/private/path";
    const redacted = redactPII(input);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("https://example.com/[REDACTED]");
    expect(redacted).not.toContain("a@example.com");
  });
});

describe("createQualityIssue", () => {
  it("creates GitHub App JWT and posts issue with installation token", async () => {
    __testOnly.resetInstallationTokenCache();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const importKeySpy = vi.spyOn(crypto.subtle, "importKey").mockResolvedValue({} as CryptoKey);
    const setIssuedAt = vi.spyOn(SignJWT.prototype, "setIssuedAt");
    const setExpirationTime = vi.spyOn(SignJWT.prototype, "setExpirationTime");
    const setIssuer = vi.spyOn(SignJWT.prototype, "setIssuer");
    const signSpy = vi.spyOn(SignJWT.prototype, "sign").mockResolvedValue("mock.jwt.token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "inst_token_1" }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await createQualityIssue(
      {
        appId: "12345",
        appPrivateKey:
          "-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAzA==\n-----END PRIVATE KEY-----",
        appInstallationId: "98765",
      },
      { title: "t", body: "b" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall[0]).toBe("https://api.github.com/app/installations/98765/access_tokens");
    expect(tokenCall[1]?.headers?.Authorization).toBe("Bearer mock.jwt.token");
    expect(setIssuedAt).toHaveBeenCalledWith(1_700_000_000);
    expect(setExpirationTime).toHaveBeenCalledWith(1_700_000_540);
    expect(setIssuer).toHaveBeenCalledWith("12345");

    const issueCall = fetchMock.mock.calls[1];
    expect(issueCall[0]).toBe("https://api.github.com/repos/kouiso/character-chat/issues");
    expect(issueCall[1]?.headers?.Authorization).toBe("Bearer inst_token_1");
    importKeySpy.mockRestore();
    signSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it("prefers Linear when LINEAR_API_KEY and LINEAR_TEAM_ID are set", async () => {
    __testOnly.resetLinearLabelCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { team: { labels: { nodes: [{ id: "lbl-1", name: "quality-degraded" }] } } },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { issueLabelCreate: { success: true, issueLabel: { id: "lbl-2" } } },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { issueCreate: { success: true, issue: { id: "i-1", identifier: "RIT-1" } } },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createQualityIssue(
      { linearApiKey: "lin_api_key", linearTeamId: "team-1" },
      { title: "t", body: "b" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("https://api.linear.app/graphql");
      expect(call[1]?.headers?.Authorization).toBe("lin_api_key");
    }
    const labelCreateBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      query: string;
      variables: { name: string; teamId: string };
    };
    expect(labelCreateBody.query).toContain("issueLabelCreate");
    expect(labelCreateBody.variables).toEqual({ name: "auto-reported", teamId: "team-1" });

    const issueBody = JSON.parse(fetchMock.mock.calls[2][1]?.body as string) as {
      query: string;
      variables: {
        input: { title: string; description: string; teamId: string; labelIds: string[] };
      };
    };
    expect(issueBody.query).toContain("issueCreate");
    expect(issueBody.variables.input.title).toBe("t");
    expect(issueBody.variables.input.description).toBe("b");
    expect(issueBody.variables.input.teamId).toBe("team-1");
    expect(issueBody.variables.input.labelIds).toEqual(["lbl-1", "lbl-2"]);
  });
});

describe("shouldReportQualityIssue", () => {
  it("skips report within 24h window", async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ conversationId: "conv-1" }]),
    };
    const database = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(),
    } as unknown as Parameters<typeof shouldReportQualityIssue>[0];

    const ok = await shouldReportQualityIssue(database, "conv-1", Date.now());
    expect(ok).toBe(false);
  });

  it("stores timestamp when outside dedup window", async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const onConflictDoUpdate = vi.fn();
    const database = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate })) })),
    } as unknown as Parameters<typeof shouldReportQualityIssue>[0];

    const ok = await shouldReportQualityIssue(database, "conv-1", Date.now());
    expect(ok).toBe(true);
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });
});
