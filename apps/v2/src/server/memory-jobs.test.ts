// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleMemoryJobBatch, MEMORY_JOB_KINDS, parseMemoryJob } from "./memory-jobs";

const message = (body: unknown) => {
  const calls: string[] = [];
  return {
    body,
    calls,
    ack: () => calls.push("ack"),
    retry: () => calls.push("retry"),
  };
};

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("Queue の記憶仕事の受け手", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(MEMORY_JOB_KINDS)("整った封筒 %s を受け取る", (kind) => {
    const job = parseMemoryJob({ kind, characterId: "char-1", conversationId: "conv-1", turn: 3 });
    expect(job).toEqual({ kind, characterId: "char-1", conversationId: "conv-1", turn: 3 });
  });

  it.each([
    undefined,
    null,
    "text",
    {},
    { kind: "extract-facts" },
    { kind: "unknown-kind", characterId: "c", conversationId: "v" },
    { kind: "embed-memory", characterId: "", conversationId: "v" },
    { kind: "embed-memory", characterId: "c", conversationId: "" },
    { kind: "summarize-window", characterId: "c", conversationId: "v", turn: -1 },
    { kind: "summarize-window", characterId: "c", conversationId: "v", turn: 1.5 },
  ])("形の合わん仕事は退ける: %j", (body) => {
    expect(parseMemoryJob(body)).toBeNull();
  });

  it("整った仕事は ack、壊れた仕事は再送せず ack、他の仕事を巻き込まん", async () => {
    const good = message({ kind: "extract-facts", characterId: "c", conversationId: "v" });
    const broken = message({ kind: "embed-memory" });
    const alsoGood = message({
      kind: "summarize-window",
      characterId: "c2",
      conversationId: "v2",
      turn: 0,
    });
    await handleMemoryJobBatch({ messages: [good, broken, alsoGood] });
    expect(good.calls).toEqual(["ack"]);
    expect(broken.calls).toEqual(["ack"]);
    expect(alsoGood.calls).toEqual(["ack"]);
  });

  // 受け手はまだ中身を持たん（PBI-06 で育てる）。届いた仕事は処理されずに消えるので、
  // 「受け取った」でなく「捨てた」と記録し、ログを読んだ人が処理済みと取り違えんようにする。
  it("中身が未実装の間は、整った仕事を捨てたと記録する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await handleMemoryJobBatch({
      messages: [message({ kind: "embed-memory", characterId: "c", conversationId: "v", turn: 2 })],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: "memory_job_discarded",
      reason: "not_implemented",
      kind: "embed-memory",
      characterId: "c",
      conversationId: "v",
      turn: 2,
    });
    expect(info).not.toHaveBeenCalled();
  });

  // 受け手が捨てるだけの間に送り手を足すと、仕事が黙って消える。送り手を足す変更は
  // 受け手の中身と同時でないと通らんよう、アプリとパッケージの本体から束縛の参照を探す。
  it("受け手が未実装の間は、MEMORY_JOBS へ送るコードがどこにも無い", () => {
    // hook から走ると GIT_DIR 等が別の場所を指すので外す。
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ) as NodeJS.ProcessEnv;
    const result = spawnSync(
      "git",
      [
        "grep",
        "-n",
        "--untracked",
        "-w",
        "MEMORY_JOBS",
        "--",
        "apps/v2/src",
        "packages",
        ":!*.test.ts",
        // 束縛の型宣言だけは名前が出る。送り手は工場関数へ渡す形（createDb(env.DB) と同じ）でも
        // 名前を参照するので、名前そのものを探せば .send の書き方に関係なく見つかる。
        ":!apps/v2/src/worker-configuration.d.ts",
      ],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    // git grep は見つからん時に 1 を返す。2 以上は検索そのものの失敗。
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });
});
