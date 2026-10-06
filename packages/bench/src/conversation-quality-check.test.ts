import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pathToFileURL } from "node:url";

import { isEntryPoint, scanDir } from "./conversation-quality-check";

const turnFile = (label: string, turn: number, user: string, body: string): [string, string] => [
  `${label}-${String(turn).padStart(2, "0")}-session-test.txt`,
  [
    `# character: ${label}`,
    `# turn: ${turn}`,
    "# intent: conversation",
    "# servedPhase: conversation",
    "# --- そのターンで送った相手の発言 ---",
    ...user.split("\n").map((line) => `# > ${line}`),
    "# --- ここから本文 ---",
    body,
    "",
  ].join("\n"),
];

describe("scanDir", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conversation-quality-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("相手の具体語に返し、相手の手は書かない", () => {
    const [name, text] = turnFile(
      "Sakura",
      5,
      "その本のページ、膝の上で開いたままスカートの裾がずれてる",
      [
        "<response>",
        "<action>膝の上の本のページから目を逸らせず、スカートの裾を自分の指で直してしまう。</action>",
        "<dialogue>「そのページ、見ないで……裾まで、そんなところまで見て」</dialogue>",
        "</response>",
      ].join("\n"),
    );
    writeFileSync(join(dir, name), text);
    const rows = scanDir(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      character: "Sakura",
      turn: 5,
      respondsToUser: true,
      inventsUserAction: false,
      hasDialogue: true,
      emptyBody: false,
    });
    expect(rows[0].evidence.respondsToUser).not.toBe("no-overlap");
  });

  it("具体語を無視して相手の手の動作を書くと捏造", () => {
    const [name, text] = turnFile(
      "Sakura",
      6,
      "本棚の奥の文庫、背表紙が褪せてる",
      [
        "<response>",
        "<action>あなたの手がスカートの裾を掴んだ。息が漏れる。</action>",
        "<dialogue>「んっ……だめ」</dialogue>",
        "</response>",
      ].join("\n"),
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(false);
    expect(row.evidence.respondsToUser).toBe("no-overlap");
    expect(row.inventsUserAction).toBe(true);
    expect(row.evidence.inventsUserAction).toContain("あなたの手が");
    expect(row.hasDialogue).toBe(true);
  });

  it("空本文は emptyBody で、台詞も無い", () => {
    const [name, text] = turnFile("Sakura", 7, "もっと奥まで入れて", "   \n");
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.emptyBody).toBe(true);
    expect(row.hasDialogue).toBe(false);
    expect(row.evidence.hasDialogue).toBe("empty-body");
    expect(row.evidence.emptyBody).toBe("empty");
  });

  it("相手の発言が空なら応答失敗にしない", () => {
    const [name, text] = turnFile(
      "Sakura",
      1,
      "",
      "<response>\n<action>自分の胸を両手で隠したまま、太腿を擦り合わせる。</action>\n<dialogue>「見ないで……」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(true);
    expect(row.evidence.respondsToUser).toBe("no-user-token");
    expect(row.inventsUserAction).toBe(false);
  });

  it("2文字の偶然一致は応答したことにしない", () => {
    const [name, text] = turnFile(
      "Sakura",
      9,
      "赤くなってるよ",
      "<response>\n<action>自分の膝を揃えたまま、視線を落とす。</action>\n<dialogue>「見ないでください」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(false);
    expect(row.evidence.respondsToUser).toBe("no-overlap");
  });

  it("トークンが重なっても相手の動作捏造は別判定", () => {
    const [name, text] = turnFile(
      "Sakura",
      8,
      "スカートの裾、自分で捲って",
      "<response>\n<action>あなたはスカートの裾を掴んだまま、さらに捲り上げた。</action>\n<dialogue>「はっ……」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(true);
    expect(row.inventsUserAction).toBe(true);
  });

  it("1文字の発言でも本文に含まれなければ応答失敗", () => {
    const [name, text] = turnFile(
      "Sakura",
      10,
      "奥",
      "<response>\n<action>自分の膝を揃えたまま、視線を落とす。</action>\n<dialogue>「見ないでください」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(false);
    expect(row.evidence.respondsToUser).toBe("no-overlap");
  });

  it("1文字の発言が本文に含まれれば応答あり", () => {
    const [name, text] = turnFile(
      "Sakura",
      11,
      "奥",
      "<response>\n<action>奥まで押し込むと息が漏れる。</action>\n<dialogue>「あっ……」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.respondsToUser).toBe(true);
    expect(row.evidence.respondsToUser).toBe("奥");
  });

  it("ユーザーが先に述べた動作の再掲は捏造にしない", () => {
    const [name, text] = turnFile(
      "Sakura",
      12,
      "俺の手がスカートの裾を掴んだ",
      "<response>\n<action>あなたの手がスカートの裾を掴んだまま、身を寄せる。</action>\n<dialogue>「はっ……」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.inventsUserAction).toBe(false);
    expect(row.evidence.inventsUserAction).toBe("restated-in-user");
  });

  it("先の動作が再掲でも後続の捏造動作は判定する", () => {
    const [name, text] = turnFile(
      "Sakura",
      13,
      "俺の手がドアを開けた",
      "<response>\n<action>あなたの手がドアを開けた。あなたの指が鍵を奪った。</action>\n<dialogue>「あっ」</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const [row] = scanDir(dir);
    expect(row.inventsUserAction).toBe(true);
    expect(row.evidence.inventsUserAction).toBe("あなたの指が");
  });

  it("ターン順とキャラ名でソートする", () => {
    const [n1, t1] = turnFile(
      "Sakura",
      2,
      "奥",
      "<response><dialogue>「奥」</dialogue></response>",
    );
    const [n2, t2] = turnFile(
      "Sakura",
      1,
      "奥",
      "<response><dialogue>「奥」</dialogue></response>",
    );
    const [n3, t3] = turnFile(
      "Downer",
      1,
      "奥",
      "<response><dialogue>「奥」</dialogue></response>",
    );
    writeFileSync(join(dir, n1), t1);
    writeFileSync(join(dir, n2), t2);
    writeFileSync(join(dir, n3), t3);
    expect(scanDir(dir).map((row) => `${row.character}:${row.turn}`)).toEqual([
      "Downer:1",
      "Sakura:1",
      "Sakura:2",
    ]);
  });
});

describe("isEntryPoint", () => {
  it("空白と日本語を含むパスで直接起動しても本体を走らせる", () => {
    const scriptPath = join(tmpdir(), "bench run", "会話", "conversation-quality-check.ts");
    const url = pathToFileURL(scriptPath).href;
    expect(url).toContain("bench%20run");
    expect(url).toContain("%E4%BC%9A%E8%A9%B1");
    expect(isEntryPoint(url, scriptPath)).toBe(true);
  });

  it("別のファイルから import された時は走らせない", () => {
    const moduleUrl = "file:///tmp/bench/conversation-quality-check.ts";
    expect(isEntryPoint(moduleUrl, "/tmp/bench/other.ts")).toBe(false);
    expect(isEntryPoint(moduleUrl, undefined)).toBe(false);
  });
});
