import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertLocalOnly, assertNotProdD1, V1_PROD_D1_ID, V2_LOCAL_D1_ID } from "./assert-local";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("assertLocalOnly", () => {
  it("rejects --remote", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--remote"])).toThrow("v2 D1 is local-only");
  });

  it("allows --local", () => {
    expect(() => assertLocalOnly(["wrangler", "d1", "--local"])).not.toThrow();
  });

  // 入口が検査を飛ばすか、移行や D1 の起動の後で検査すると、--remote を付けた時に止まる前に D1 へ触る。
  const entries = (() => {
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    return Object.values(manifest.scripts).flatMap((script) =>
      [...script.matchAll(/tsx (src\/[\w-]+\.ts)/g)].map((match) => match[1]),
    );
  })();

  it("package.json に tsx 入口がある", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s は D1 に触る呼び出しより先に引数を検査する", (entry) => {
    const code = readFileSync(path.join(packageRoot, entry), "utf8")
      .replace(/\/\*[\S\s]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const guard = code.indexOf("assertLocalOnly(process.argv");
    expect(guard).toBeGreaterThanOrEqual(0);
    for (const call of ["applyLocalMigrations(", "createPlatform("]) {
      const at = code.indexOf(call);
      if (at >= 0) expect({ call, beforeGuard: at < guard }).toEqual({ call, beforeGuard: false });
    }
  });

  it.each(entries)(
    "%s を --remote で起こすと、移行も D1 の起動もせずに止まる",
    (entry) => {
      const result = spawnSync(
        path.join(packageRoot, "node_modules/.bin/tsx"),
        [entry, "--remote"],
        { cwd: packageRoot, encoding: "utf8", timeout: 60_000 },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(output).toContain("v2 D1 is local-only");
      // 移行が走ると wrangler の見出しと適用結果が混ざる。
      for (const sign of ["⛅️ wrangler", "Migrations to be applied", "No migrations to apply"]) {
        expect(output).not.toContain(sign);
      }
    },
    70_000,
  );
});

describe("assertNotProdD1", () => {
  it("v2 local id is not the production database", () => {
    expect(V2_LOCAL_D1_ID).not.toEqual(V1_PROD_D1_ID);
    expect(() => assertNotProdD1(V1_PROD_D1_ID)).toThrow("v2 must not bind the production D1 id");
    expect(() => assertNotProdD1(V2_LOCAL_D1_ID)).not.toThrow();
  });

  it("ローカル用の wrangler 設定は本番 D1 を指さん", () => {
    const source = readFileSync(path.join(packageRoot, "wrangler.local.jsonc"), "utf8");
    const ids = [...source.matchAll(/"database_id":\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([V2_LOCAL_D1_ID]);
  });
});
