import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { saveCharacter } from "./character";
import { ensureSessionContext, readSessionContext } from "./session-context";
import { characterFixture } from "./test/character-fixture";
import { openCharacterTestDb, type CharacterTestDb } from "./test/character-local-d1";

let local: CharacterTestDb;
const scope = {
  ownerUserId: "synthetic-owner",
  characterId: characterFixture.id,
  conversationId: "session-original",
};

beforeAll(async () => {
  local = await openCharacterTestDb();
  for (const name of ["0070_v2_tables.sql", "0087_v2_session_context.sql"]) {
    const ddl = await readFile(new URL(`../../../drizzle/${name}`, import.meta.url), "utf8");
    await local.d1.batch(
      ddl
        .split(";")
        .filter((text) => text.trim())
        .map((text) => local.d1.prepare(text)),
    );
  }
  await saveCharacter(local.db, scope.ownerUserId, characterFixture);
});
afterAll(async () => local?.dispose());

it("keeps one server worldline and immutable character version across edits and restart", async () => {
  const original = await ensureSessionContext(local.db, scope, "synthetic-version");
  await saveCharacter(local.db, scope.ownerUserId, {
    ...characterFixture,
    name: "更新した合成案内係",
  });
  const resumed = await ensureSessionContext(local.db, scope, "synthetic-version");
  expect(resumed).toEqual(original);
  const fresh = await ensureSessionContext(
    local.db,
    { ...scope, conversationId: "session-new-version" },
    "synthetic-version",
  );
  expect(fresh.character.name).toBe("更新した合成案内係");
  expect(fresh.worldlineId).not.toBe(original.worldlineId);
  expect(fresh.characterVersionId).not.toBe(original.characterVersionId);
  await local.reopen();
  expect(await readSessionContext(local.db, scope)).toEqual(original);
});

it("does not expose or replace a context through another owner or character", async () => {
  await expect(
    ensureSessionContext(local.db, { ...scope, ownerUserId: "another-owner" }, "synthetic"),
  ).rejects.toThrow();
  expect(await readSessionContext(local.db, { ...scope, ownerUserId: "another-owner" })).toBeNull();
  await saveCharacter(local.db, scope.ownerUserId, {
    ...characterFixture,
    id: "another-character",
  });
  await expect(
    ensureSessionContext(local.db, { ...scope, characterId: "another-character" }, "synthetic"),
  ).rejects.toThrow();
  expect((await readSessionContext(local.db, scope))?.character.id).toBe(scope.characterId);
});

it("concurrent first initialization adopts exactly one worldline and snapshot", async () => {
  const request = { ...scope, conversationId: "session-race" };
  const contexts = await Promise.all([
    ensureSessionContext(local.db, request, "synthetic"),
    ensureSessionContext(local.db, request, "synthetic"),
  ]);
  expect(contexts[0]).toEqual(contexts[1]);
  const rows = await local.d1
    .prepare("SELECT worldline_id FROM v2_session_context WHERE conversation_id=?")
    .bind(request.conversationId)
    .all();
  expect(rows.results).toHaveLength(1);
});

it("does not attribute pre-snapshot legacy messages to a guessed character version", async () => {
  const request = { ...scope, conversationId: "legacy-unversioned" };
  await local.d1
    .prepare(
      "INSERT INTO v2_conversation (id,user_id,character_id,thread_id,prompt_version,created_at,updated_at) VALUES (?,?,?,?,?,0,0)",
    )
    .bind(
      request.conversationId,
      request.ownerUserId,
      request.characterId,
      request.conversationId,
      "legacy",
    )
    .run();
  await local.d1
    .prepare(
      "INSERT INTO v2_message (id,conversation_id,turn,role,content,created_at) VALUES ('legacy-message',?,1,'user','synthetic legacy input',?)",
    )
    .bind(request.conversationId, Date.now() + 1_000_000_000)
    .run();
  const context = await ensureSessionContext(local.db, request, "synthetic");
  expect(context.sourceStartTurn).toBe(2);
});

it("can use an official character while retaining private session ownership", async () => {
  await local.d1
    .prepare(
      "INSERT INTO user (id,email,created_at) VALUES ('synthetic-author','author@example.invalid',0)",
    )
    .run();
  const published = { ...characterFixture, id: "published-guide", isOfficial: true };
  await saveCharacter(local.db, "synthetic-author", published);
  const request = {
    ...scope,
    characterId: published.id,
    conversationId: "public-character-private-session",
  };
  const context = await ensureSessionContext(local.db, request, "synthetic");
  expect(context.ownerUserId).toBe(scope.ownerUserId);
  expect(
    await readSessionContext(local.db, { ...request, ownerUserId: "synthetic-author" }),
  ).toBeNull();
  await saveCharacter(local.db, "synthetic-author", { ...published, isOfficial: false });
  await expect(ensureSessionContext(local.db, request, "synthetic")).rejects.toThrow();
  expect(await readSessionContext(local.db, request)).toEqual(context);
});
