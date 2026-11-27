// createPlatform が重なった時に、先に終わった方が残りの呼び出しのログ抑制を外さん事を確かめる。
import { afterEach, describe, expect, it } from "vitest";

import { withQuietWrangler } from "./quiet-wrangler";

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// 開発者が手元で決めた WRANGLER_LOG を、試験の後に元へ戻す
const original = process.env.WRANGLER_LOG;

describe("withQuietWrangler", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.WRANGLER_LOG;
    else process.env.WRANGLER_LOG = original;
  });

  it("重なった呼び出しの片方が終わっても、もう片方が終わるまで warn のまま", async () => {
    delete process.env.WRANGLER_LOG;
    const firstGate = deferred();
    const secondGate = deferred();
    let seenBySecondAfterFirst: string | undefined;
    const first = withQuietWrangler(async () => {
      await firstGate.promise;
    });
    const second = withQuietWrangler(async () => {
      await secondGate.promise;
      seenBySecondAfterFirst = process.env.WRANGLER_LOG;
    });
    firstGate.resolve();
    await first;
    expect(process.env.WRANGLER_LOG).toBe("warn");
    secondGate.resolve();
    await second;
    expect(seenBySecondAfterFirst).toBe("warn");
    expect(process.env.WRANGLER_LOG).toBeUndefined();
  });

  it("呼び出し側が決めた WRANGLER_LOG は上書きも削除もせん", async () => {
    process.env.WRANGLER_LOG = "log";
    let seen: string | undefined;
    await withQuietWrangler(async () => {
      seen = process.env.WRANGLER_LOG;
    });
    expect(seen).toBe("log");
    expect(process.env.WRANGLER_LOG).toBe("log");
  });

  it("中で失敗しても元に戻す", async () => {
    delete process.env.WRANGLER_LOG;
    await expect(
      withQuietWrangler(async () => {
        throw new Error("起動に失敗");
      }),
    ).rejects.toThrow("起動に失敗");
    expect(process.env.WRANGLER_LOG).toBeUndefined();
  });
});
