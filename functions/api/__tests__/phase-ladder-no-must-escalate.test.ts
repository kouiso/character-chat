// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONVERSATION_XML_HINT,
  PLATFORM_BASE_CONVERSATION,
  PLATFORM_BASE_SCENE,
  SCENE_RESPONSE_STRUCTURE,
} from "../../../src/lib/prompt-variant-defaults";

import type { DatabaseSync } from "node:sqlite";

// A5 / C3 (doc/backlog-2026-08-17.md)。「まだ胸の段やのに手マンに入る」のプロンプト側。
//
// champion の body は同じ [Phase progression guideline] を 3 箇所に持っとって、うち 2 箇所
// (scene_response_structure / conversation_xml_hint) は
//   - user_msg に親密・性的キューがあれば、対応する phase へ MUST escalate する。
// を、2 行下の
//   このフェーズを最低2ターン維持すること。急いで erotic に飛ばない。
// より先に置いとった。同じブロックの中で MUST が「維持すること」を上書きするので、既にある
// 急がん要件は最初から負けとる。指示を足しても勝たん（prompt-edit-discipline の Gate 0）。
//
// しかもこのブロックは erotic/climax の中身まで並べる。今どの段におるかはこの message に
// 書いてへん——段と天井は augmentMessages が最後のユーザー発言の直前へ差す
// SCENE_CONTEXT_MESSAGES / PHASE_CEILING が渡す。実際 SCENE_CONTEXT_MESSAGES.erotic は
//   Ignore any earlier prompt that describes erotic as 'clothes off / fingertip stimulation ...'
// という打ち消しを持っとって、この一覧を末尾から否定しとった。打ち消される側を消す。

const CONTRADICTION =
  "- user_msg に親密・性的キューがあれば、対応する phase へ MUST escalate する。";
const PACING = "このフェーズを最低2ターン維持すること。急いで erotic に飛ばない。";
const RUNG_LIST = `- intimate: 距離が近づく描写、触れる、抱きしめる、息遣いが混ざる、触れられたがる
- foreplay (焦らし): キスの延長、服の上から触る、手を導く、焦らすように止める、「まだ？」と聞く。
  ${PACING}
- erotic: 肌・衣服を解く、指先の刺激、腰がくねる
- climax: 絶頂・達する
- afterglow: 事後の余韻・息が整う・タオル・水・休む・寄りかかる
`;
const KEEP_NO_REGRESSION =
  "- afterglow中は穏やかな会話や未来のキスの約束が出ても、余韻と休息の空気を維持し、erotic/intimateへ戻さない";
const KEEP_NO_CONVERSATION_RESET =
  "- ⚠️ユーザーがエスカレーションしたら conversation へ絶対に戻してはいけない⚠️";

// D1 に入っとる置換前の本文を、置換後の定数へ削除ぶんを挿し戻して組み立てる。
// 別の literal で持つと、定数を触ったときに二つが黙って食い違う。
const withLadderRestored = (body: string): string =>
  body
    .replace(
      "- user_msg の明示的な身体的・感情的キューと、直前ターンの phase を必ず読む。\n",
      `- user_msg の明示的な身体的・感情的キューと、直前ターンの phase を必ず読む。\n${CONTRADICTION}\n`,
    )
    .replace(KEEP_NO_REGRESSION, `${RUNG_LIST}${KEEP_NO_REGRESSION}`);

describe("配られる champion 本文の段の案内", () => {
  it("MUST escalate が残ってへん", () => {
    for (const body of [
      PLATFORM_BASE_SCENE,
      PLATFORM_BASE_CONVERSATION,
      SCENE_RESPONSE_STRUCTURE,
      CONVERSATION_XML_HINT,
    ]) {
      expect(body).not.toContain("MUST escalate");
    }
  });

  it("急がん要件そのものは残す", () => {
    expect(PLATFORM_BASE_SCENE).toContain(PACING);
  });

  // 「進めるな」にはせん。求められた行動を同じ応答で完了する要求と、
  // conversation / afterglow から戻さん要求は消さん。
  it("場面を止めん指示と後退させん指示は残す", () => {
    expect(PLATFORM_BASE_SCENE).toContain("Do NOT de-escalate when the user leads.");
    expect(PLATFORM_BASE_SCENE).toContain("complete that action in <action> in the same response");
    for (const body of [SCENE_RESPONSE_STRUCTURE, CONVERSATION_XML_HINT]) {
      expect(body).toContain(KEEP_NO_REGRESSION);
      expect(body).toContain(KEEP_NO_CONVERSATION_RESET);
      expect(body).toContain("同じレスポンス内に完了する");
    }
  });

  // 先の段のレシピを、今どの段かを言わん message で渡さん。
  it("先の段の中身を並べん", () => {
    for (const body of [SCENE_RESPONSE_STRUCTURE, CONVERSATION_XML_HINT]) {
      expect(body).not.toContain("- erotic: 肌・衣服を解く");
      expect(body).not.toContain("- climax: 絶頂・達する");
      expect(body).not.toContain("- intimate: 距離が近づく描写");
    }
  });

  // conversation フェーズの天井は元から別ブロックが言うとる。段の一覧を消しても
  // 「まだ行為は始まっていない」の宣言は残る。
  it("会話フェーズの天井は別ブロックが持っとる", () => {
    expect(PLATFORM_BASE_CONVERSATION).toContain("【会話フェーズの上限】");
    expect(PLATFORM_BASE_CONVERSATION).toContain("まだ行為は始まっていない");
  });
});

// 定数を直しても、実際に配られるのは D1 の prompt_variant 行。
const ROOT = path.resolve(__dirname, "../../..");
const migration = readFileSync(
  path.join(ROOT, "drizzle/0069_phase_ladder_pacing_in_prompt_variant.sql"),
  "utf8",
);

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

const migrate = (...bodies: string[]): string[] => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const database = new DatabaseSyncCtor(":memory:");
  database.exec("CREATE TABLE prompt_variant (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  const insert = database.prepare("INSERT INTO prompt_variant (id, body) VALUES (?, ?)");
  bodies.forEach((body, index) => insert.run(`variant-${index}`, body));
  database.exec(migration);
  const rows = database.prepare("SELECT body FROM prompt_variant ORDER BY id").all() as {
    body: string;
  }[];
  database.close();
  return rows.map((row) => row.body);
};

describe.skipIf(!DatabaseSyncCtor)("0069 は D1 の champion を定数と同じ本文へ揃える", () => {
  it("scene_response_structure", () => {
    const before = withLadderRestored(SCENE_RESPONSE_STRUCTURE);
    expect(before).toContain("MUST escalate");

    expect(migrate(before)).toEqual([SCENE_RESPONSE_STRUCTURE]);
  });

  it("conversation_xml_hint", () => {
    const before = withLadderRestored(CONVERSATION_XML_HINT);
    expect(before).toContain("MUST escalate");

    expect(migrate(before)).toEqual([CONVERSATION_XML_HINT]);
  });

  it("急がん要件を持つ platform_scene には触らん", () => {
    expect(migrate(PLATFORM_BASE_SCENE)).toEqual([PLATFORM_BASE_SCENE]);
    expect(PLATFORM_BASE_SCENE).toContain(PACING);
  });

  // migration は既に当たった行へも走りうる。二度目で何も変わらんこと。
  it("既に落ちとる行へ再適用しても変わらん", () => {
    expect(migrate(SCENE_RESPONSE_STRUCTURE, CONVERSATION_XML_HINT)).toEqual([
      SCENE_RESPONSE_STRUCTURE,
      CONVERSATION_XML_HINT,
    ]);
  });
});
