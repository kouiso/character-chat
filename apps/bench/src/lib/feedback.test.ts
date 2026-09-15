/* eslint-disable @typescript-eslint/no-floating-promises -- node:test の test() は Promise を返すが、待つ側はテストランナーや */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { recordEndOfRun, recordUtterance, summarizeFeedback } from "./feedback.ts";

// 本物の feedback.jsonl には触らん。局長の判定を俺が代わりに書くわけにはいかんからや。
test("👍の口は end-of-run と任意votesを別々に数える", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-feedback-"));
  const path = join(dir, "feedback.jsonl");
  try {
    recordEndOfRun({ runId: "r1", came: true, wouldContinue: true }, path);
    recordEndOfRun({ runId: "r2", came: false, wouldContinue: true }, path);
    recordUtterance({ runId: "r1", turnIndex: 3, vote: "up" }, path);
    recordUtterance({ runId: "r1", turnIndex: 9, vote: "down" }, path);
    const s = summarizeFeedback(path);
    assert.equal(s.runs, 2);
    assert.equal(s.came, 1);
    assert.equal(s.wouldContinue, 2);
    assert.equal(s.thumbsUp, 1);
    assert.equal(s.thumbsDown, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
