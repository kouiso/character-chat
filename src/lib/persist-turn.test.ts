import { describe, expect, it } from "vitest";

import { persistTurn, type PersistPresence, type PersistTurnDeps } from "./persist-turn";

class AmbiguousError extends Error {
  constructor() {
    super("network error");
    this.name = "AbortError";
  }
}

class DefiniteError extends Error {
  constructor() {
    super("persist failed: 500");
  }
}

type HarnessOptions = {
  /** その kind の createRow が n 回目に投げるエラー（undefined なら成功）。 */
  createFails?: Partial<Record<"user" | "assistant", (attempt: number) => Error | undefined>>;
  /** 固定値、または「その kind の n 回目の読み直し」で返す値。 */
  confirm?: Partial<
    Record<"user" | "assistant", PersistPresence | ((attempt: number) => PersistPresence)>
  >;
  deleteFails?: boolean;
  /** 画面を D1 へ揃え直せなかった場合。 */
  resyncFails?: boolean;
};

const createHarness = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const attempts: Record<string, number> = { user: 0, assistant: 0 };
  const confirms: Record<string, number> = { user: 0, assistant: 0 };

  const deps: PersistTurnDeps = {
    createRow: async (kind) => {
      attempts[kind] += 1;
      calls.push(`create:${kind}#${attempts[kind]}`);
      const failure = options.createFails?.[kind]?.(attempts[kind]);
      if (failure) throw failure;
    },
    confirmPersisted: async (kind) => {
      confirms[kind] += 1;
      const configured = options.confirm?.[kind];
      const result =
        typeof configured === "function" ? configured(confirms[kind]) : (configured ?? "unknown");
      calls.push(`confirm:${kind}=${result}`);
      return result;
    },
    deleteUserRow: async () => {
      calls.push("deleteUserRow");
      if (options.deleteFails) throw new Error("delete failed");
    },
    resyncFromPersisted: async () => {
      calls.push("resync");
      return options.resyncFails !== true;
    },
    removeAssistantBubble: () => {
      calls.push("removeAssistantBubble");
    },
    markUserRetryable: () => {
      calls.push("markUserRetryable");
    },
    logError: () => undefined,
  };

  return { deps, calls };
};

describe("persistTurn", () => {
  it("writes both rows when nothing fails", async () => {
    const harness = createHarness();
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual(["create:user#1", "create:assistant#1"]);
  });

  // 応答つきの失敗でも、行が無いことは読み直して初めて確定する。
  it("marks the turn retryable once the user row is read back as absent", async () => {
    const harness = createHarness({
      createFails: { user: () => new DefiniteError() },
      confirm: { user: "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    // 返信は書きに行かない。書くと user 行の無い返信が残る。
    expect(harness.calls).not.toContain("create:assistant#1");
    expect(harness.calls).toContain("markUserRetryable");
  });

  // エンドポイントは messages を INSERT した後に memory_note の書き込みを続けており、
  // 後段が落ちても 500 を返す。500 を「入っていない」と決め打つと、在る行に対して
  // 再送可能へ戻し、再送で行が二重になる。だから 500 でも読み直してから決める。
  it("treats a 500 on the user write as success when the row is actually there", async () => {
    const harness = createHarness({
      createFails: { user: () => new DefiniteError() },
      confirm: { user: "present" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual(["create:user#1", "confirm:user=present", "create:assistant#1"]);
    expect(harness.calls).not.toContain("markUserRetryable");
    // 在ったので入れ直さない。入れ直したら二重になる。
    expect(harness.calls).not.toContain("create:user#2");
  });

  // 返信側で同じことが起きると、在る返信を消したうえで発言を再送可能へ戻す。
  it("treats a 500 on the assistant write as success when the row is actually there", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new DefiniteError() },
      confirm: { assistant: "present" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual([
      "create:user#1",
      "create:assistant#1",
      "confirm:assistant=present",
    ]);
    expect(harness.calls).not.toContain("deleteUserRow");
    expect(harness.calls).not.toContain("markUserRetryable");
  });

  it("continues when the ambiguous user write turns out to have landed", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : undefined) },
      confirm: { user: "present" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    // 在ったので入れ直さない。二重化を避ける。
    expect(harness.calls).toEqual(["create:user#1", "confirm:user=present", "create:assistant#1"]);
  });

  it("reinserts the same user row when the ambiguous write did not land", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : undefined) },
      confirm: { user: "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual([
      "create:user#1",
      "confirm:user=absent",
      "create:user#2",
      "create:assistant#1",
    ]);
  });

  // codex P1: 自分の発言が在ると確定できないまま返信を書くと、user 行の無い返信だけが D1 に残る。
  it("never writes the assistant row while the user row is unconfirmed", async () => {
    const harness = createHarness({
      createFails: { user: () => new AmbiguousError() },
      confirm: { user: "unknown" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("resynced");
    expect(harness.calls).not.toContain("create:assistant#1");
    expect(harness.calls).toContain("resync");
  });

  // codex P1: 返信の保存が曖昧なまま成功として閉じると、再読込で返信が消える。
  it("reinserts the assistant row when its ambiguous write did not land", async () => {
    const harness = createHarness({
      createFails: { assistant: (n) => (n === 1 ? new AmbiguousError() : undefined) },
      confirm: { assistant: "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual([
      "create:user#1",
      "create:assistant#1",
      "confirm:assistant=absent",
      "create:assistant#2",
    ]);
  });

  // 入れ直しが応答つきで失敗した＝無いことが確定しとる。「分からん」へ格下げすると、
  // 再送できる状態へ戻せないまま画面だけ揃えることになる。
  it("keeps a definite reinsert failure definite", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : new DefiniteError()) },
      confirm: { user: "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    expect(harness.calls).toContain("markUserRetryable");
    expect(harness.calls).not.toContain("resync");
  });

  // 最初の POST がクライアント側のタイムアウトを跨いでサーバで生き残ると、confirm が
  // absent を読んだ後にその INSERT が着地する。入れ直しは同じ id の衝突として 500 で
  // 弾かれるが、行は在る。これを確定失敗として扱うと、再送で行が二重になる。
  it("treats a reinsert conflict as success when the row turns out to be there", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : new DefiniteError()) },
      confirm: { user: (n) => (n === 1 ? "absent" : "present") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toEqual([
      "create:user#1",
      "confirm:user=absent",
      "create:user#2",
      "confirm:user=present",
      "create:assistant#1",
    ]);
    // 3 回目の書き込みはせん。したら二重になる。
    expect(harness.calls).not.toContain("create:user#3");
  });

  it("keeps the failure definite when the reconfirm still reads absent", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : new DefiniteError()) },
      confirm: { user: () => "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    expect(harness.calls).toContain("markUserRetryable");
    expect(harness.calls).not.toContain("create:assistant#1");
  });

  it("falls back to resync when the reconfirm itself cannot be read", async () => {
    const harness = createHarness({
      createFails: { user: (n) => (n === 1 ? new AmbiguousError() : new DefiniteError()) },
      confirm: { user: (n) => (n === 1 ? "absent" : "unknown") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("resynced");
    // 在否が分からんまま返信を書くと、user 行の無い返信が残る。
    expect(harness.calls).not.toContain("create:assistant#1");
    expect(harness.calls).not.toContain("markUserRetryable");
    expect(harness.calls).toContain("resync");
  });

  // 揃え直しが失敗しとるのに "resynced" で閉じると、画面は完了したターンに見えるのに
  // D1 がそれを持っとらん、という食い違いが黙って残る。
  it("reports unreconciled when the resync itself failed", async () => {
    const harness = createHarness({
      createFails: { user: () => new AmbiguousError() },
      confirm: { user: "unknown" },
      resyncFails: true,
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("unreconciled");
    expect(harness.calls).toContain("resync");
  });

  it("reports unreconciled when the assistant resync failed", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new AmbiguousError() },
      confirm: { assistant: "unknown" },
      resyncFails: true,
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("unreconciled");
  });

  // codex P1: unknown は「無い」の確定やない。もう一度確認して実は在ったなら、
  // 返信を書かずに止めたら応答が永遠に来ない。
  it("resumes the assistant write once an unconfirmed user row turns out to be present", async () => {
    const harness = createHarness({
      createFails: { user: () => new AmbiguousError() },
      confirm: { user: (n) => (n === 1 ? "unknown" : "present") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).toContain("create:assistant#1");
    expect(harness.calls).not.toContain("markUserRetryable");
    expect(harness.calls).not.toContain("resync");
  });

  // codex P1: unknown のまま resync すると、markUserRetryable していない発言は
  // resyncFromPersisted の queued 判定(sendFailed のものだけ残す)から漏れて画面から消える。
  // markUserRetryable を resync より先に呼んで、消える前に再送可能へ落とす。
  it("marks the user row retryable before resyncing once it is confirmed absent", async () => {
    const harness = createHarness({
      createFails: { user: () => new AmbiguousError() },
      confirm: { user: (n) => (n === 1 ? "unknown" : "absent") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    expect(harness.calls).not.toContain("create:assistant#1");
    const retryIndex = harness.calls.indexOf("markUserRetryable");
    const resyncIndex = harness.calls.indexOf("resync");
    expect(retryIndex).toBeGreaterThan(-1);
    expect(resyncIndex).toBeGreaterThan(-1);
    expect(retryIndex).toBeLessThan(resyncIndex);
  });

  // 返信側でも同じ穴がある。unknown のまま止めると、user 行だけ在って返信が
  // 永遠に来ない見た目になる。
  it("reports persisted once an unconfirmed assistant row turns out to be present", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new AmbiguousError() },
      confirm: { assistant: (n) => (n === 1 ? "unknown" : "present") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("persisted");
    expect(harness.calls).not.toContain("deleteUserRow");
    expect(harness.calls).not.toContain("markUserRetryable");
  });

  it("rolls back once an unconfirmed assistant row turns out to be genuinely absent", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new AmbiguousError() },
      confirm: { assistant: (n) => (n === 1 ? "unknown" : "absent") },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    expect(harness.calls).toContain("deleteUserRow");
    expect(harness.calls).toContain("removeAssistantBubble");
    expect(harness.calls).toContain("markUserRetryable");
  });

  it("reports unreconciled when the rollback and the resync both failed", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new DefiniteError() },
      confirm: { assistant: "absent" },
      deleteFails: true,
      resyncFails: true,
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("unreconciled");
    expect(harness.calls).not.toContain("markUserRetryable");
  });

  it("resyncs instead of succeeding when the assistant row cannot be confirmed", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new AmbiguousError() },
      confirm: { assistant: "unknown" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("resynced");
    expect(harness.calls).toContain("resync");
  });

  it("rolls the user row back once the assistant row is read back as absent", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new DefiniteError() },
      confirm: { assistant: "absent" },
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("user_retryable");
    expect(harness.calls).toEqual([
      "create:user#1",
      "create:assistant#1",
      "confirm:assistant=absent",
      "create:assistant#2",
      "confirm:assistant=absent",
      "deleteUserRow",
      "removeAssistantBubble",
      "markUserRetryable",
    ]);
  });

  // codex P1: 取り消しが確定していない時に成功として閉じると、返信が無いのに送れたように見える。
  it("resyncs rather than succeeding when the rollback cannot complete", async () => {
    const harness = createHarness({
      createFails: { assistant: () => new DefiniteError() },
      confirm: { assistant: "absent" },
      deleteFails: true,
    });
    await expect(persistTurn(harness.deps)).resolves.toBe("resynced");
    // 未送達へは戻さない。戻すと DELETE が通っていなかった場合に user 行が増える。
    expect(harness.calls).not.toContain("markUserRetryable");
    expect(harness.calls).toContain("resync");
  });
});
