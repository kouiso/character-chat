import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const varsFile = new URL("../.dev.vars", import.meta.url);
const password = randomBytes(32).toString("hex");
const variables = `BASIC_AUTH_USERNAME=runtime-test\nBASIC_AUTH_PASSWORD=${password}\nAPP_ENV=test\nV2_FAKE_MODEL=1\nV2_TEST_FAULT=none\n`;
const url = "http://127.0.0.1:3111";
const headers = {
  authorization: `Basic ${Buffer.from(`runtime-test:${password}`).toString("base64")}`,
};
let server;
let output = "";

const run = (args, env = process.env) =>
  execFileSync("pnpm", args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
const ready = async () => {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error("Runtime server exited before readiness");
    try {
      const response = await fetch(`${url}/api/health`, { headers, signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).mockModel === true) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Runtime server readiness timed out");
};

await writeFile(varsFile, variables, { flag: "wx", mode: 0o600 });
try {
  run([
    "--filter",
    "@v2/app",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "adult-ai-db",
    "--local",
    "--persist-to",
    "../../.wrangler/state",
    "--config",
    "../../packages/cf/wrangler.local.jsonc",
  ]);
  run(["--filter", "@v2/app", "seed:local"]);
  server = spawn(
    "pnpm",
    [
      "--filter",
      "@v2/app",
      "exec",
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "3111",
      "--strictPort",
    ],
    { cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-20_000);
  });
  server.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-20_000);
  });
  await ready();
  process.stdout.write(
    run(["--filter", "@v2/app", "verify:runtime"], { ...process.env, V2_VERIFY_URL: url }),
  );
} catch (error) {
  process.stderr.write(output);
  throw error;
} finally {
  if (server?.pid) {
    try {
      process.kill(process.platform === "win32" ? server.pid : -server.pid, "SIGTERM");
    } catch {}
  }
  if ((await readFile(varsFile, "utf8").catch(() => null)) === variables) await rm(varsFile);
}
