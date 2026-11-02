// @vitest-environment node
// 資格情報検査は CI のログへ結果を出す。見つけた値を一部でも出すと、検査そのものが
// 鍵を公開ログへ漏らす経路になるので、場所と変数名だけを出すことを固定する。
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../script/check-repo-secrets.mjs", import.meta.url));
const IGNORE_RULES = [
  ".dev.vars*",
  "apps/v2/.dev.vars*",
  "functions/.dev.vars",
  ".prod-verify.vars",
];

// git の hook から走ると GIT_DIR 等が親 repo を指したままになり、使い捨て repo を素通りする。
const isolatedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
) as NodeJS.ProcessEnv;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// 検査は自分の置き場所から 3 つ上を repo とみなすので、使い捨ての repo へ写して走らせる。
const runIn = (
  files: Record<string, string>,
  untracked: Record<string, string> = {},
  scriptEnv: NodeJS.ProcessEnv = isolatedEnv,
) => {
  const root = mkdtempSync(join(tmpdir(), "secrets-check-"));
  roots.push(root);
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", env: isolatedEnv });
  git("init", "-q");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(".gitignore", `${IGNORE_RULES.join("\n")}\n`);
  mkdirSync(join(root, "apps/v2/script"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "apps/v2/script/check-repo-secrets.mjs"));
  for (const [path, text] of Object.entries(files)) write(path, text);
  git("add", "-A");
  for (const [path, text] of Object.entries(untracked)) write(path, text);
  const result = spawnSync(process.execPath, ["apps/v2/script/check-repo-secrets.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: scriptEnv,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const expectNoPartOf = (output: string, value: string) => {
  for (let start = 0; start + 4 <= value.length; start++) {
    expect(output).not.toContain(value.slice(start, start + 4));
  }
};

describe("資格情報検査の出力", () => {
  it("きれいな repo は通る", () => {
    const { status, output } = runIn({
      "src/app.ts":
        'const key = process.env.OPENROUTER_API_KEY;\nexport const API_KEY = "placeholder";\n',
    });
    expect(output).toContain("資格情報検査: OK");
    expect(status).toBe(0);
  });

  it.each([
    [
      "裸の代入",
      "BASIC_AUTH_PASSWORD",
      "Xy7pQ2mN9vR4tL8kW3zB",
      (name: string, value: string) => `${name}=${value}`,
    ],
    [
      "引用符つき",
      "OPENROUTER_API_KEY",
      "Qa9ZkT4mW2xR7vN3pL6s",
      (name: string, value: string) => `export ${name} = "${value}";`,
    ],
    [
      "JSON の値",
      "SLACK_BOT_TOKEN",
      "Mn3Bv8Cx2Zl5Kj7Hg4Fd",
      (name: string, value: string) => `{ "${name}": "${value}" }`,
    ],
    [
      "小文字の名前（YAML の設定など）",
      "openrouter_api_key",
      "Ab3Cd5Ef7Gh9Jk2Lm4Np",
      (name: string, value: string) => `${name}: "${value}"`,
    ],
  ])("%s: 見つけたら失敗させ、場所と変数名だけを出す", (_label, name, value, line) => {
    const { status, output } = runIn({
      "config/settings.txt": `first\nsecond\n${line(name, value)}\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("tracked:config/settings.txt:3");
    expect(output).toContain(name);
    expectNoPartOf(output, value);
  });

  // 実際に漏れる形は「短いが混ざったパスワード」「小文字と数字だけの長い鍵」「接頭辞つきの鍵」
  // 「URL に埋めた資格情報」。どれも値を一文字も出さずに場所だけを示す。
  // この試験ファイル自体も検査対象なので、行は「前・値・後」に分けて置き、実行時に繋ぐ。
  it.each([
    ["短いが英大小と数字が混ざったパスワード", "BASIC_AUTH_PASSWORD=", "Hunter2Pass", ""],
    [
      "小文字と数字だけの長い鍵",
      'OPENROUTER_API_KEY="',
      "abcdefghijklmnopqrstuvwxyz0123456789",
      '"',
    ],
    ["AWS のアクセスキー", "aws = AKIA", "2Q7XK4M9PZ3T6WRB", ""],
    ["Stripe の本番鍵", 'stripe("sk_live_', "4eC39HqLyjWDarjtT1zdp7dc", '")'],
    ["GitHub の OAuth トークン", 't = "gho_', "Ab3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6", '"'],
    [
      "URL に埋めた資格情報",
      "DATABASE_URL=postgres://admin:",
      "Hunter2Pass",
      "@db.internal:5432/app",
    ],
  ])("%s を見逃さず、値を出さない", (_label, before, value, after) => {
    const { status, output } = runIn({ "config/leak.txt": `first\n${before}${value}${after}\n` });
    expect(status).not.toBe(0);
    expect(output).toContain("tracked:config/leak.txt:2");
    expectNoPartOf(output, value);
  });

  // 誤検知が多いと検査ごと外されるので、鍵でない書き方は通すことも固定する。
  it.each([
    'export const API_KEY = "placeholder";',
    "BASIC_AUTH_PASSWORD=<手元用>",
    "PASSWORD: z.string().min(8),",
    "const SESSION_TOKEN = crypto.randomUUID();",
    "SECRET_KEY=${SECRET_KEY}",
    'const CACHE_KEY = "chat-history-v2";',
    'const STORAGE_KEY = "character-chat-v2-staging-history";',
    "DEFAULT_MAX_TOKEN = 4096",
    'BASIC_AUTH_PASSWORD="password"',
    "OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY",
    "curl -u user:pass https://example.com/",
    "https://user:${PASSWORD}@db.internal/app",
  ])("鍵でない書き方は通す: %s", (line) => {
    const { status, output } = runIn({ "src/config.ts": `${line}\n` });
    expect(output).toContain("資格情報検査: OK");
    expect(status).toBe(0);
  });

  it("形の決まった鍵も値を出さずに行で示す", () => {
    const value = `sk-or-v1-${"a1b2c3d4".repeat(8)}`;
    const { status, output } = runIn({ "src/leak.ts": `\nconst k = "${value}";\n` });
    expect(status).not.toBe(0);
    expect(output).toContain("tracked:src/leak.ts:2");
    expectNoPartOf(output, value.slice("sk-or-v1-".length));
  });

  it("ビルド成果物の中の鍵も値を出さずに失敗させる", () => {
    const value = "Pz4Lk8Jh2Gf6Ds9Aq3Wr";
    const { status, output } = runIn(
      {},
      { "apps/v2/dist/server/index.js": `var BASIC_AUTH_PASSWORD="${value}";\n` },
    );
    expect(status).not.toBe(0);
    expect(output).toContain("build:apps/v2/dist/server/index.js:1");
    expect(output).toContain("BASIC_AUTH_PASSWORD");
    expectNoPartOf(output, value);
  });

  // URL として読むと # 以降が fragment、? 以降が query、% が復号になり、別の名前を読みに行く。
  // 読めずに飛ばすと、その追跡ファイルは検査されんまま通る。
  it.each(["config/leak#1.txt", "config/leak?1.txt", "config/leak%41.txt"])(
    "名前に URL の記号を含む追跡ファイル %s も検査する",
    (path) => {
      const value = "Rt5Yu8Io2Pa4Sd6Fg9Hj";
      const { status, output } = runIn({ [path]: `BASIC_AUTH_PASSWORD=${value}\n` });
      expect(status).not.toBe(0);
      expect(output).toContain(`tracked:${path}:1`);
      expectNoPartOf(output, value);
    },
  );

  // git の hook から走ると GIT_DIR・GIT_WORK_TREE が別の repo を指したまま渡ってくる。
  // そのまま git を呼ぶと、別の repo の追跡一覧を検査して通してしまう。
  it("親から GIT_DIR を渡されても、自分の置き場所の repo を検査する", () => {
    const other = mkdtempSync(join(tmpdir(), "secrets-other-"));
    roots.push(other);
    spawnSync("git", ["init", "-q"], { cwd: other, env: isolatedEnv });
    const value = "Kl3Zx7Cv1Bn5Mq8We2Rt";
    const { status, output } = runIn(
      { "config/leak.txt": `BASIC_AUTH_PASSWORD=${value}\n` },
      {},
      {
        ...isolatedEnv,
        GIT_DIR: join(other, ".git"),
        GIT_WORK_TREE: other,
      },
    );
    expect(status).not.toBe(0);
    expect(output).toContain("tracked:config/leak.txt:1");
    expectNoPartOf(output, value);
  });
});
