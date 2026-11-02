import { CharacterConflictError, CharacterVersionNotFoundError } from "@v2/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  handleCharacterRequest,
  handleCharacterRestoreRequest,
  handleCharacterVersionRequest,
  handleCharacterVersionsRequest,
  handleCharactersRequest,
} from "./api-characters";
import { toCharacterDisplay } from "./characters";

import type * as Db from "@v2/db";

const validContent = (name = "入力") => ({
  name,
  personality: "落ち着いた人柄",
  speechStyle: "短く話す",
  greeting: "こんにちは。",
  privateNotes: "所有者だけのメモ",
});

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(() => ({ database: true })),
  createCharacterWithVersion: vi.fn(),
  updateCharacterWithVersion: vi.fn(),
  restoreCharacterVersion: vi.fn(),
  readCharacterDetail: vi.fn(),
  readCharacterVersion: vi.fn(),
  listCharacterVersions: vi.fn(),
  getPlatform: vi.fn(async () => ({ env: { DB: {} } })),
}));

vi.mock("@v2/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  createDb: mocks.createDb,
  createCharacterWithVersion: mocks.createCharacterWithVersion,
  updateCharacterWithVersion: mocks.updateCharacterWithVersion,
  restoreCharacterVersion: mocks.restoreCharacterVersion,
  readCharacterDetail: mocks.readCharacterDetail,
  readCharacterVersion: mocks.readCharacterVersion,
  listCharacterVersions: mocks.listCharacterVersions,
}));

vi.mock("./platform", () => ({ getPlatform: mocks.getPlatform }));

const jsonRequest = (method: string, body: unknown) =>
  new Request("https://example.test/api/characters", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("character REST handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with the server owner and returns a private no-store response", async () => {
    mocks.createCharacterWithVersion.mockResolvedValue({
      id: "character-1",
      revision: 1,
      versionId: "version-1",
    });
    const response = await handleCharactersRequest(
      jsonRequest("POST", { ...validContent(), userId: "attacker" }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      id: "character-1",
      revision: 1,
      versionId: "version-1",
    });
    expect(mocks.createCharacterWithVersion).toHaveBeenCalledWith(
      { database: true },
      "local",
      expect.objectContaining({ name: "入力" }),
    );
  });

  it("rejects cross-site and non-JSON mutations", async () => {
    const crossOrigin = new Request("https://example.test/api/characters", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: JSON.stringify(validContent()),
    });
    const crossSite = new Request("https://example.test/api/characters", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify(validContent()),
    });
    const textBody = new Request("https://example.test/api/characters", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(validContent()),
    });
    expect((await handleCharactersRequest(crossOrigin)).status).toBe(403);
    expect((await handleCharactersRequest(crossSite)).status).toBe(403);
    expect((await handleCharactersRequest(textBody)).status).toBe(415);
    expect(mocks.createCharacterWithVersion).not.toHaveBeenCalled();

    mocks.createCharacterWithVersion.mockResolvedValue({
      id: "character-1",
      revision: 1,
      versionId: "version-1",
    });
    const sameOrigin = new Request("https://example.test/api/characters", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify(validContent()),
    });
    expect((await handleCharactersRequest(sameOrigin)).status).toBe(201);
    expect(mocks.createCharacterWithVersion).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin updates and non-JSON restores", async () => {
    const update = new Request("https://example.test/api/characters/character-1", {
      method: "PUT",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, content: validContent() }),
    });
    const restore = new Request("https://example.test/api/characters/character-1/restore", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ versionId: "version-1", expectedRevision: 1 }),
    });
    expect((await handleCharacterRequest("character-1", update)).status).toBe(403);
    expect((await handleCharacterRestoreRequest("character-1", restore)).status).toBe(415);
    expect(mocks.updateCharacterWithVersion).not.toHaveBeenCalled();
    expect(mocks.restoreCharacterVersion).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and invalid character IDs", async () => {
    const malformed = new Request("https://example.test/api/characters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect((await handleCharactersRequest(malformed)).status).toBe(422);
    expect((await handleCharactersRequest(jsonRequest("POST", {}))).status).toBe(422);
    expect(
      (await handleCharacterRequest("x".repeat(121), new Request("https://x.test"))).status,
    ).toBe(422);
    expect(
      (
        await handleCharacterRequest(
          "character-1",
          jsonRequest("PUT", {
            expectedRevision: -1,
            content: validContent(),
          }),
        )
      ).status,
    ).toBe(422);
    expect(mocks.createCharacterWithVersion).not.toHaveBeenCalled();
  });

  it("maps owner detail, missing resources, conflicts, and storage failures", async () => {
    mocks.readCharacterDetail.mockResolvedValueOnce({
      id: "character-1",
      revision: 1,
      currentVersionId: "version-1",
      ownerUserId: "local",
      content: { name: "private", privateNotes: "秘密" },
    });
    const detail = await handleCharacterRequest("character-1", new Request("https://x.test"));
    expect(detail.status).toBe(200);
    expect(detail.headers.get("cache-control")).toContain("no-store");
    expect(await detail.json()).toMatchObject({ content: { privateNotes: "秘密" } });

    mocks.readCharacterDetail.mockResolvedValueOnce(null);
    expect((await handleCharacterRequest("missing", new Request("https://x.test"))).status).toBe(
      404,
    );
    mocks.updateCharacterWithVersion.mockRejectedValueOnce(new CharacterConflictError());
    expect(
      (
        await handleCharacterRequest(
          "character-1",
          jsonRequest("PUT", {
            expectedRevision: 1,
            content: validContent(),
          }),
        )
      ).status,
    ).toBe(409);
    mocks.readCharacterDetail.mockRejectedValueOnce(new Error("private storage detail"));
    const unavailable = await handleCharacterRequest("character-1", new Request("https://x.test"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private storage detail");
    mocks.readCharacterDetail.mockRejectedValueOnce(new z.ZodError([]));
    expect(
      (await handleCharacterRequest("character-1", new Request("https://x.test"))).status,
    ).toBe(503);
  });

  it("serves version metadata and content only for valid owner reads", async () => {
    mocks.listCharacterVersions.mockResolvedValue({
      currentVersionId: "version-2",
      versions: [{ id: "version-2", version: 2, createdAt: 10 }],
      history: [],
    });
    expect(
      (await handleCharacterVersionsRequest("character-1", new Request("https://x.test"))).status,
    ).toBe(200);
    mocks.readCharacterVersion.mockResolvedValueOnce({
      id: "version-2",
      version: 2,
      content: { name: "テストキャラクター", privateNotes: "所有者専用" },
      createdAt: 10,
    });
    const version = await handleCharacterVersionRequest(
      "character-1",
      "version-2",
      new Request("https://x.test"),
    );
    expect(await version.json()).toMatchObject({ content: { privateNotes: "所有者専用" } });
    mocks.readCharacterVersion.mockResolvedValueOnce(null);
    expect(
      (
        await handleCharacterVersionRequest(
          "character-1",
          "version-other",
          new Request("https://x.test"),
        )
      ).status,
    ).toBe(404);
  });

  it("restores immutable versions and maps missing-version errors", async () => {
    mocks.restoreCharacterVersion.mockResolvedValueOnce({
      revision: 3,
      versionId: "version-1",
    });
    const restored = await handleCharacterRestoreRequest(
      "character-1",
      jsonRequest("POST", { versionId: "version-1", expectedRevision: 2 }),
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      id: "character-1",
      revision: 3,
      versionId: "version-1",
    });
    mocks.restoreCharacterVersion.mockRejectedValueOnce(new CharacterVersionNotFoundError());
    expect(
      (
        await handleCharacterRestoreRequest(
          "character-1",
          jsonRequest("POST", { versionId: "not-owned", expectedRevision: 2 }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("public character display DTO", () => {
  it("returns only id and name, never the prompt that mirrors private notes", () => {
    const display = toCharacterDisplay({
      id: "character-1",
      name: "表示名",
      systemPrompt: "【演出メモ】秘密の内容",
      privateNotes: "秘密の内容",
    });
    expect(display).toEqual({ id: "character-1", name: "表示名" });
    expect(JSON.stringify(display)).not.toContain("秘密");
  });
});
