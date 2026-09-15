import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanDirs } from "./refusal-check";

// script-run が書く transcript の最小形。本文マーカー以降だけが走査対象。
const turnFile = (label: string, turn: number, body: string): [string, string] => [
  `${label}-${String(turn).padStart(2, "0")}-session-test.txt`,
  [
    `# character: ${label}`,
    `# turn: ${turn}`,
    "# intent: conversation",
    "# servedPhase: conversation",
    "# --- ここから本文 ---",
    body,
    "",
  ].join("\n"),
];

describe("scanDirs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "refusal-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("本文中の拒否文をヒットとして拾う", () => {
    const [name, text] = turnFile(
      "Sakura",
      1,
      "<response>\n<dialogue>申し訳ありませんが、そのようなリクエストにはお応えできません。</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const { scanned, hits } = scanDirs([dir], new Set());
    expect(scanned).toBe(1);
    // 1 文が複数パターンに掛かるのは正常。全部ヒットとして出る。
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ character: "Sakura", turn: 1 });
  });

  it("クリーンな本文はヒット 0", () => {
    const [name, text] = turnFile(
      "Downer",
      1,
      "<response>\n<dialogue>……もう少しここにいて。</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const { scanned, hits } = scanDirs([dir], new Set());
    expect(scanned).toBe(1);
    expect(hits).toHaveLength(0);
  });

  it("--ai-persona のキャラでは AI 宣言パターンを飛ばすが core 拒否は残す", () => {
    // As an AI は末尾 3 件の AI 宣言系。AI 人格キャラの本文なら正当な発言。
    const [aiName, aiText] = turnFile(
      "Botchan",
      1,
      "<response>\n<dialogue>As an AI, 私はAIです。</dialogue>",
    );
    const [coreName, coreText] = turnFile(
      "Botchan",
      2,
      "<response>\n<dialogue>このような内容は書けません。</dialogue>",
    );
    writeFileSync(join(dir, aiName), aiText);
    writeFileSync(join(dir, coreName), coreText);
    const { hits } = scanDirs([dir], new Set(["Botchan"]));
    expect(hits).toHaveLength(1);
    expect(hits[0].turn).toBe(2);
  });

  it("AI 宣言パターンは非指定キャラだとヒットする", () => {
    const [name, text] = turnFile(
      "Botchan",
      1,
      "<response>\n<dialogue>As an AI, I can't help.</dialogue>",
    );
    writeFileSync(join(dir, name), text);
    const { hits } = scanDirs([dir], new Set());
    expect(hits.length).toBeGreaterThan(0);
  });

  it("ヘッダ側（相手の発言欄）の拒否文言は本文ではないので数えない", () => {
    const name = "Sakura-03-session-test.txt";
    const text = [
      "# character: Sakura",
      "# turn: 3",
      "# intent: conversation",
      "# servedPhase: conversation",
      "# --- そのターンで送った相手の発言 ---",
      "# > リクエストにはお応えできません",
      "# --- ここから本文 ---",
      "<response>",
      "<dialogue>……うん、分かった。</dialogue>",
      "",
    ].join("\n");
    writeFileSync(join(dir, name), text);
    const { scanned, hits } = scanDirs([dir], new Set());
    expect(scanned).toBe(1);
    expect(hits).toHaveLength(0);
  });
});
