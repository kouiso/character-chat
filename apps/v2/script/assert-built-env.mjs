// deploy 直前に「wrangler がこれから出す設定」が頼んだ環境のものかを確かめる。
// Cloudflare の vite プラグインはビルド時の CLOUDFLARE_ENV で設定を平らにして
// dist/server/wrangler.json へ焼き、wrangler deploy はそちらへ転送される。
// 普通のビルドの後に `--env staging` を付けても、その焼かれた本番設定のまま出てしまう
// （本番 D1・R2 を指す本番 Worker を staging のつもりで上書きする）ので、ここで止める。
// 使い方: node script/assert-built-env.mjs <production|staging> [--app-dir <dir>]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENVS = ["production", "staging"];

const parseArgs = (argv) => {
  const args = { envName: undefined, appDir: fileURLToPath(new URL("..", import.meta.url)) };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--app-dir") args.appDir = resolve(argv[++index] ?? "");
    else args.envName = argv[index];
  }
  return args;
};

const sorted = (values) => [...values].sort();
const pick = (list, keys) =>
  sorted((list ?? []).map((item) => keys.map((key) => `${key}=${item?.[key] ?? ""}`).join(",")));

// deploy 先を決める項目だけを比べる。パスの書き方などビルドで変わる項目は見ん。
const deployTarget = (config) => ({
  name: config.name ?? null,
  targetEnvironment: config.targetEnvironment ?? null,
  d1_databases: pick(config.d1_databases, ["binding", "database_name", "database_id"]),
  r2_buckets: pick(config.r2_buckets, ["binding", "bucket_name"]),
  vectorize: pick(config.vectorize, ["binding", "index_name"]),
  queue_producers: pick(config.queues?.producers, ["binding", "queue"]),
  queue_consumers: pick(config.queues?.consumers, ["queue"]),
  durable_objects: pick(config.durable_objects?.bindings, ["name", "class_name"]),
  APP_ENV: config.vars?.APP_ENV ?? null,
  required_secrets: sorted(config.secrets?.required ?? []),
});

const main = async () => {
  const { envName, appDir } = parseArgs(process.argv.slice(2));
  const problems = [];
  if (!ENVS.includes(envName)) {
    console.error(`出す環境を ${ENVS.join(" か ")} で指定してください`);
    process.exit(2);
  }
  // CLOUDFLARE_ENV が残っとると、wrangler はビルドも deploy もそちらへ寄せる。
  // 頼んだ環境と食い違う時は、どちらが本当の意図か分からんので出さん。
  const shellEnv = process.env.CLOUDFLARE_ENV || undefined;
  const wranglerEnv = envName === "production" ? undefined : envName;
  if (shellEnv !== wranglerEnv) {
    problems.push(`CLOUDFLARE_ENV（${shellEnv ?? "未設定"}）が頼んだ環境 ${envName} と食い違う`);
  }

  const redirectPath = join(appDir, ".wrangler/deploy/config.json");
  const builtPath = join(appDir, "dist/server/wrangler.json");
  if (!existsSync(redirectPath) || !existsSync(builtPath)) {
    problems.push("ビルド成果物が無い（先に vite build を回す）");
  } else {
    const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
    const deployedPath = resolve(join(appDir, ".wrangler/deploy"), redirect.configPath ?? "");
    // wrangler が実際に読む設定と、ここで確かめる設定が別物なら確かめた意味が無い。
    if (deployedPath !== builtPath) {
      problems.push("wrangler の転送先が dist/server/wrangler.json でない（別の場所へのビルドが残っとる）");
    } else {
      delete process.env.CLOUDFLARE_ENV;
      const { unstable_readConfig: readConfig } = await import("wrangler");
      const expected = deployTarget(
        readConfig({ config: join(appDir, "wrangler.jsonc"), env: wranglerEnv }),
      );
      expected.targetEnvironment = wranglerEnv ?? null;
      const built = deployTarget(JSON.parse(readFileSync(builtPath, "utf8")));
      for (const key of Object.keys(expected)) {
        if (JSON.stringify(expected[key]) !== JSON.stringify(built[key])) {
          problems.push(`${key} が ${envName} の設定と違う`);
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`deploy を止めた: ビルド済みの設定が ${envName} 向けでない`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`  ${envName === "staging" ? "pnpm run deploy:staging" : "pnpm run deploy"} で作り直してから出す`);
    process.exit(1);
  }
  console.log(`ビルド済みの設定は ${envName} 向け`);
};

await main();
