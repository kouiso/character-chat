import { describe, expect, it } from "vitest";

import { DEV_PERSIST_ROOT, resolvePersistRoot } from "./local-d1";

describe("テストのローカル D1 置き場", () => {
  it("dev サーバーの .wrangler/state を指さない", () => {
    const root = resolvePersistRoot();
    expect(root).not.toBe(DEV_PERSIST_ROOT);
    expect(root.startsWith(`${DEV_PERSIST_ROOT}/`)).toBe(false);
  });
});
