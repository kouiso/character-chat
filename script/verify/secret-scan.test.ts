// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run, scanArtifact, scanIndex } from "./secret-scan";

describe("資格情報の混入検査", () => {
  let cwd: string;
  const token = ["sk", "or", "v1", "synthetic".repeat(8)].join("-");
  const pemHeader = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
  const pemPayload = "A".repeat(32);
  const stage = (file: string, text: string) => {
    writeFileSync(join(cwd, file), text);
    execFileSync("git", ["add", "--", file], { cwd });
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "secret-scan-"));
    execFileSync("git", ["init", "--quiet"], { cwd });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("空の index と値の無い見本は許可する", () => {
    expect(scanIndex(cwd)).toEqual([]);
    stage(".env.example", "OPENROUTER_API_KEY=\n");
    expect(scanIndex(cwd)).toEqual([]);
  });

  it("作業ファイルから消しても index に残るキーを検出する", () => {
    stage("app.ts", token);
    writeFileSync(join(cwd, "app.ts"), "clean");
    expect(scanIndex(cwd)).toEqual(["app.ts"]);
  });

  it("資格情報ファイルと、見本に紛れたキーも検出する", () => {
    stage(".dev.vars", "BASIC_AUTH_PASSWORD=local-only\n");
    stage(".env.example", token);
    expect(scanIndex(cwd)).toEqual([".dev.vars", ".env.example"]);
  });

  it.each([
    ["sk", "ant", "api03", "synthetic".repeat(8)].join("-"),
    "ghp_" + "a".repeat(40),
    "github_pat_" + "b".repeat(60),
  ])("対応するキー形式を本文やバイナリに含む場合は拒否する (%#)", (value) => {
    stage("sample.bin", "\0" + value);
    expect(scanIndex(cwd)).toEqual(["sample.bin"]);
  });

  it("PEM ヘッダーだけでは拒否しない", () => {
    stage("sample.pem", pemHeader);
    expect(scanIndex(cwd)).toEqual([]);
  });

  it.each([
    ["改行", `${pemHeader}\n${pemPayload}`],
    ["エスケープ改行", `${pemHeader}\\n${pemPayload}`],
  ])("PEM 本文を含む場合は拒否する (%s)", (_format, value) => {
    stage("sample.bin", "\0" + value);
    expect(scanIndex(cwd)).toEqual(["sample.bin"]);
  });

  it("無視された資格情報ファイルも index に入れば拒否する", () => {
    stage(".dev.vars.backup", "local-only");
    stage(".dev.vars-backup", "local-only");
    stage(".gitignore", ".dev.vars*\n");
    expect(scanIndex(cwd)).toEqual([".dev.vars-backup", ".dev.vars.backup"]);
  });

  it("成果物の隠しファイル・キー・symlinkを検出する", () => {
    const output = join(cwd, "dist");
    mkdirSync(output);
    writeFileSync(join(output, ".env"), "local-only");
    writeFileSync(join(output, "app.js"), token);
    symlinkSync(join(cwd, ".git"), join(output, "linked"));
    expect(scanArtifact(output)).toEqual([".env", "app.js", "linked"].map((p) => join(output, p)));
  });

  it.each([
    ["改行", `${pemHeader}\n${pemPayload}`],
    ["エスケープ改行", `${pemHeader}\\n${pemPayload}`],
  ])("成果物の PEM 本文を検出する (%s)", (_format, value) => {
    const output = join(cwd, "dist");
    mkdirSync(output);
    writeFileSync(join(output, "private.pem"), value);
    expect(scanArtifact(output)).toEqual([join(output, "private.pem")]);
  });

  it("出力にキーを出さず失敗し、存在しない成果物も成功扱いにしない", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stage("app.ts", token);
    stage(`.env.${token}`, "local-only");
    stage(`.env.${pemHeader}${pemPayload}`, "local-only");
    expect(run([], cwd)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).not.toContain(token);
    expect(error.mock.calls.flat().join("\n")).not.toContain(pemHeader);
    expect(error.mock.calls.flat().join("\n")).not.toContain(pemPayload);
    expect(run(["--artifact", "missing"], cwd)).toBe(2);
    expect(run(["--artifact", ""], cwd)).toBe(2);
    expect(run(["--unknown"], cwd)).toBe(2);
  });
});
