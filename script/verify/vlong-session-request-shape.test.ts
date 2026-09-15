import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildChatHeaders,
  buildMessagePersistBody,
  isScenePhase,
} from "./vlong-session-request-shape";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

// ハーネスの既定が very_long やった間、読解アーム 22 本は全部
// 「局長が使っとらん設定」を測っとった。route-context.ts:4473-4482 は長さで別の
// 長文指示を渡すので、既定の経路にだけある欠陥は一つも見えん。
// 実例: 交互の指示（1つのタグに行を積み上げん）が very_long 側にしか入っとらんかった。
//
// 出荷既定は store の zod スキーマが持つ。ハーネスは React を引っぱらんために値を
// 写しとるので、写しがずれた時にここで落とす。
// 測定ハーネスも実クライアントと同じく assistant の id を載せる。載せんと
// quality_measurement.message_id が NULL のままで、「どの試行が配られたか」を
// 測定から追えん（実測 2026-08-20 phase55 で紐づき 0 件やった）。
describe("buildChatHeaders", () => {
  it("assistant の id をヘッダへ載せる", () => {
    expect(buildChatHeaders("conv-1", "asst-1")["x-assistant-message-id"]).toBe("asst-1");
  });

  it("id が無い時はヘッダを足さん", () => {
    expect(buildChatHeaders("conv-1")).not.toHaveProperty("x-assistant-message-id");
  });
});

describe("ハーネスの既定が出荷既定と一致する", () => {
  const appDefault = readSource("src/store/settings-store.ts").match(
    /responseLength:\s*z\.enum\(\[[^\]]*\]\)\.default\("(\w+)"\)/u,
  )?.[1];
  const harnessDefault = readSource("script/verify/vlong-session-dogfood.ts").match(
    /const DEFAULT_RESPONSE_LENGTH:\s*ResponseLength\s*=\s*"(\w+)"/u,
  )?.[1];

  it("両方を読み取れる（正規表現が腐っとらん）", () => {
    expect(appDefault).toBeDefined();
    expect(harnessDefault).toBeDefined();
  });

  it("同じ値を指しとる", () => {
    expect(harnessDefault).toBe(appDefault);
  });

  it("ハーネスが --length 無しで very_long を測らん", () => {
    expect(harnessDefault).not.toBe("very_long");
    expect(readSource("script/verify/vlong-session-dogfood.ts")).not.toContain(
      'arg("length") ?? "very_long"',
    );
  });
});

// #バグ: vlong-session-dogfood.ts が /api/chat に x-conversation-id を付けず、
// assistant 保存の body に servedPhase を積まんかったため、applyPhaseFloor が
// 一度も効かんまま計測しとった。実クライアントと同じ形を守ることをここで固定する。
describe("vlong session dogfood のリクエスト形", () => {
  it("会話idがあれば x-conversation-id ヘッダを付ける", () => {
    expect(buildChatHeaders("conv-1")).toEqual({ "x-conversation-id": "conv-1" });
  });

  it("会話idが無ければ x-conversation-id を付けん", () => {
    expect(buildChatHeaders(undefined)).toEqual({});
  });

  it("assistant保存のbodyに読んだservedPhaseをgenerationPhaseとして積む", () => {
    const body = buildMessagePersistBody({
      id: "msg-1",
      role: "assistant",
      content: "hello",
      generationPhase: "intimate",
    });
    expect(body).toMatchObject({
      id: "msg-1",
      role: "assistant",
      content: "hello",
      generationPhase: "intimate",
    });
  });

  it("generationPhaseが無ければbodyにキー自体を積まん", () => {
    const body = buildMessagePersistBody({ id: "msg-1", role: "assistant", content: "hi" });
    expect(body).not.toHaveProperty("generationPhase");
  });

  it("isScenePhase は既知の5値だけを認め、それ以外とnullを弾く", () => {
    expect(isScenePhase("conversation")).toBe(true);
    expect(isScenePhase("intimate")).toBe(true);
    expect(isScenePhase("erotic")).toBe(true);
    expect(isScenePhase("climax")).toBe(true);
    expect(isScenePhase("afterglow")).toBe(true);
    expect(isScenePhase("bogus")).toBe(false);
    expect(isScenePhase(null)).toBe(false);
  });
});

// 本番は会話を作った瞬間にサーバが挨拶を1行目の assistant として保存し
// （functions/api/routes/conversations.ts:190-195）、クライアントもそれを積む
// （ou-app.tsx の addConversationGreetingMessage）。ハーネスが積まんかった間、
// 台帳の turn 1 は全部「本番が一度も送らん形（system + user だけ）」を測っとった。
// これは既定が very_long にズレとった時と同じ型の欠陥で、同じ場所で塞ぐ。
describe("ハーネスが本番と同じ形で turn 1 を測る", () => {
  const harness = readSource("script/verify/vlong-session-dogfood.ts");

  it("会話作成の応答から挨拶を受け取る", () => {
    expect(harness).toMatch(/greetingMessageId/u);
    expect(harness).toMatch(/characterGreeting/u);
  });

  it("挨拶を最初の assistant ターンとして history へ積む", () => {
    expect(harness).toMatch(
      /history\.push\(\{\s*role:\s*"assistant",\s*content:\s*greeting\s*\}\)/u,
    );
  });

  it("挨拶を保存し直さん（サーバが既に保存しとるので二重になる）", () => {
    const greetingBlock = harness.slice(
      harness.indexOf("const { id: conversationId, greeting }"),
      harness.indexOf("const { id: conversationId, greeting }") + 600,
    );
    expect(greetingBlock).not.toMatch(/persistMessage\([^)]*greeting/u);
  });
});

// L1「UI の 4 段が実際に 4 段の長さになる」は 4 段全部の実測が要る。
// matrix モードが long を落としとった間、その段だけ誰にも確かめられんかった。
describe("matrix モードが 4 段すべてを測る", () => {
  const harness = readSource("script/verify/vlong-session-dogfood.ts");

  it("MATRIX_LENGTHS に short/medium/long/very_long が揃っとる", () => {
    const line = harness.match(/const MATRIX_LENGTHS[^;]*;/u)?.[0] ?? "";
    for (const length of ["short", "medium", "long", "very_long"]) {
      expect(line).toContain(length);
    }
  });
});

// 2026-08-20 の phase66 通読で「climax の床が発火しとらん」と誤読した。根拠にしたのは
// ダンプヘッダの `retryCount: 0` やったが、サーバがそこへ入れとるのは refusalRetryCount
// （拒否ラベルでの撮り直し）で、品質の撮り直し回数やない。同じイベントに
// refusalRetryCount という正しい名前でも同じ値が入っとる。
// 罠 §5-2（char_length がタグ込みの生の長さ）と同じ形。名前と中身が食い違う列を
// ダンプへ書くと、次に読む人も同じ読み違えをする。
describe("ダンプへ名前と中身が食い違う列を書かん", () => {
  it("quality ヘッダから曖昧な retryCount を落としとる", () => {
    const source = readSource("script/verify/vlong-session-dogfood.ts");
    expect(source).toContain("formatQualityMeta");
    // JSON.stringify(record.qualityMeta) をそのまま書くと retryCount がダンプへ出る。
    expect(source).not.toContain("JSON.stringify(record.qualityMeta)");
  });
});
