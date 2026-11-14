import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string | undefined;

// テストが dev の .wrangler/state を共用すると、dev サーバーと SQLITE_BUSY で衝突し、
// テストの行が dev の会話一覧へ残る（#159）。実行ごとの一時 store を worker 起動前に差し込む。
// 同時に走る別の実行は別ディレクトリになるので互いに掴み合わない。
export const setup = async (): Promise<void> => {
  root = await mkdtemp(join(tmpdir(), "v2-test-d1-"));
  process.env.WRANGLER_PERSIST_DIR = root;
};

export const teardown = async (): Promise<void> => {
  if (root) await rm(root, { recursive: true, force: true });
};
