// v2:db:check から叩く動作確認用 CLI。ローカル D1 の character を @v2/db の loadCharacters
// （Drizzle 行 → zod で行ごとに検証）に通し、{ n, zodPassed, failures } を出す。
import { createDb, loadCharacters } from "@v2/db";

import { applyLocalMigrations } from "./migrate";

import { createPlatform } from "./index";

const main = async (): Promise<void> => {
  applyLocalMigrations();
  const { env, dispose } = await createPlatform();
  try {
    const { ok, failures } = await loadCharacters(createDb(env.DB));
    console.log(
      JSON.stringify({ n: ok.length + failures.length, zodPassed: ok.length, failures }, null, 2),
    );
  } finally {
    await dispose();
  }
};

await main();
