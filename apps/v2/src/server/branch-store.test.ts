// RIT-202: 枝分かれの確かめ — 代替系列・active 張り替え・戻る/進むを実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateBranch,
  listBranchSiblings,
  restoreFromTurn,
  rewriteUserMessage,
  saveAssistantBranch,
  truncateFromTurn,
} from "../../../../packages/db/src/branch-store";
import { createDb } from "../../../../packages/db/src/client";
import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

let local: LocalD1;

const CONV = `conv-${crypto.randomUUID()}`;
const CHAR = `char-${crypto.randomUUID()}`;

beforeAll(async () => {
  local = await openLocalD1();
  const db = local.d1;
  await db
    .prepare("INSERT OR IGNORE INTO user (id, email, created_at) VALUES ('local', 'l@x', 1)")
    .run();
  await db
    .prepare(
      "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags, created_at) VALUES (?, 'local', 'c', 'sp', 'g', '[]', 1)",
    )
    .bind(CHAR)
    .run();
  await db
    .prepare(
      "INSERT INTO v2_conversation (id, user_id, character_id, thread_id, prompt_version, created_at, updated_at) VALUES (?, 'local', ? , ?, 'v', 1, 1)",
    )
    .bind(CONV, CHAR, CONV)
    .run();
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

const db = () => createDb(local.d1);

const insertMsg = (turn: number, role: "user" | "assistant", content: string, branchNo = 0) =>
  local.d1
    .prepare(
      "INSERT INTO v2_message (id, conversation_id, turn, role, content, branch_no, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
    .bind(crypto.randomUUID(), CONV, turn, role, content, branchNo, Date.now())
    .run();

describe("branch store", () => {
  it("rewrite はユーザー行を新しい枝として差し替え、旧枝は眠る", async () => {
    await insertMsg(1, "user", "元の発話");
    const id = await rewriteUserMessage(db(), CONV, 1, "書き換えた発話");
    expect(id).not.toBeNull();
    const siblings = await listBranchSiblings(db(), CONV, 1, "user");
    expect(siblings).toHaveLength(2);
    expect(siblings.filter((s) => s.active)).toHaveLength(1);
    expect(siblings.find((s) => s.active)?.content).toBe("書き換えた発話");
    expect(siblings.find((s) => s.active)?.branchNo).toBe(1);
  });

  it("assistant の枝は saveAssistantBranch で追加され1本だけ active", async () => {
    await insertMsg(1, "assistant", "最初の返答");
    await saveAssistantBranch(db(), {
      conversationId: CONV,
      turn: 1,
      content: "再生成した返答",
      action: null,
      dialogue: null,
      inner: null,
      generationId: null,
      provider: null,
      upstreamId: null,
      ledgerJson: "{}",
    });
    const siblings = await listBranchSiblings(db(), CONV, 1, "assistant");
    expect(siblings).toHaveLength(2);
    expect(siblings.find((s) => s.active)?.content).toBe("再生成した返答");
  });

  it("activateBranch で古い枝へ戻せる", async () => {
    const siblings = await listBranchSiblings(db(), CONV, 1, "assistant");
    const first = siblings.find((s) => s.branchNo === 0);
    expect(await activateBranch(db(), first!.id)).toBe("ok");
    const after = await listBranchSiblings(db(), CONV, 1, "assistant");
    expect(after.find((s) => s.active)?.id).toBe(first!.id);
    expect(await activateBranch(db(), "no-such-id")).toBe("not-found");
  });

  it("truncateFromTurn で turn 以降が眠り、restoreFromTurn で最新枝が起きる", async () => {
    await insertMsg(2, "user", "2ターン目");
    await insertMsg(2, "assistant", "2ターン目の返答");
    await truncateFromTurn(db(), CONV, 2);
    let siblings = await listBranchSiblings(db(), CONV, 2, "user");
    expect(siblings.every((s) => !s.active)).toBe(true);
    await restoreFromTurn(db(), CONV, 2);
    siblings = await listBranchSiblings(db(), CONV, 2, "user");
    expect(siblings.find((s) => s.branchNo === 0)?.active).toBe(true);
  });

  it("active=1 の部分一意索引で同グループの2本同時 active は拒否される", async () => {
    await insertMsg(3, "user", "3ターン目");
    await expect(
      local.d1
        .prepare(
          "INSERT INTO v2_message (id, conversation_id, turn, role, content, branch_no, active, created_at) VALUES (?, ?, 3, 'user', '重複', 1, 1, 1)",
        )
        .bind(crypto.randomUUID(), CONV)
        .run(),
    ).rejects.toThrow();
  });
});
