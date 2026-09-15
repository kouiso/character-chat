import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";
import {
  resolveJudgeSceneName,
  resolveSceneConstraintMemo,
  shouldRunClaudeJudge,
  type ChatMessage,
} from "../lib/route-context";

// #(桜庭さくら 会話崩壊): resolveSceneConstraintMemo はハードコード地名リスト
// (寝室|ベッドルーム|ホテル|リビング|キッチン|浴室|シャワー室|教室|屋上)にしか反応せず、
// 桜並木・カフェのような場所は【シーン制約】節すら無いキャラでは一生 null のままやった。
// null のままだと ABSOLUTE_SCENE_REINFORCEMENT が一生発火せず、9ターンの短尺会話で
// turn3「普段って、どんな本読むの」を機に場面が学校図書館へ丸ごと飛んだ後、戻らんかった。

const SAKURA_SCENARIO_PROMPT = [
  "【キャラクター】",
  "名前: さくら",
  "20歳の文学部女子大生",
  "",
  "【シナリオ】",
  "あなたは桜並木の道でさくらに声をかけた。さくらは一瞬戸惑い、小さく微笑んだ。" +
    "これからカフェに行くという誘いを受けたばかり。二人きりの時間が始まる。",
].join("\n");

const RAINY_ROOM_SCENARIO_PROMPT = [
  "【キャラクター】",
  "名前: みお",
  "23歳のOL",
  "",
  "【シナリオ】",
  "雨の夜、あなたはみおの部屋に立ち寄った。傘から滴る雨音だけが静かに響いている。",
].join("\n");

// 既存のハードコード地名リストに一致するキャラ。フォールバックを足しても、
// この経路の挙動(sceneName・source)が変わってはいけない。
const CLASSROOM_SCENARIO_PROMPT = [
  "【キャラクター】",
  "名前: ゆい",
  "",
  "【シナリオ】",
  "放課後の教室で二人きりになった。",
].join("\n");

describe("resolveSceneConstraintMemo: 【シナリオ】節へのフォールバック", () => {
  it("桜並木/カフェのようにハードコード地名リストに無い場所でも【シナリオ】から場面を導く", () => {
    const memo = resolveSceneConstraintMemo([], SAKURA_SCENARIO_PROMPT);
    expect(memo).not.toBeNull();
    expect(memo?.source).toBe("character_scenario_section");
    expect(memo?.sceneName).toContain("桜並木");
    expect(memo?.sceneName).toContain("カフェ");
  });

  it("雨の夜/部屋のような組み合わせでも【シナリオ】から場面を導く", () => {
    const memo = resolveSceneConstraintMemo([], RAINY_ROOM_SCENARIO_PROMPT);
    expect(memo).not.toBeNull();
    expect(memo?.source).toBe("character_scenario_section");
    expect(memo?.sceneName).toContain("雨の夜");
    expect(memo?.sceneName).toContain("部屋");
  });

  it("ハードコード地名リストに一致するキャラは従来どおり character_system_prompt 経由のまま", () => {
    const memo = resolveSceneConstraintMemo([], CLASSROOM_SCENARIO_PROMPT);
    expect(memo).not.toBeNull();
    expect(memo?.source).toBe("character_system_prompt");
    expect(memo?.sceneName).toBe("教室");
  });

  it("【シナリオ】節すら無いキャラは従来どおり null のまま(会話メッセージへフォールバック)", () => {
    const noScenarioPrompt = ["【キャラクター】", "名前: 名無し"].join("\n");
    const messages: ChatMessage[] = [{ role: "user", content: "こんにちは" }];
    const memo = resolveSceneConstraintMemo(messages, noScenarioPrompt);
    expect(memo).toBeNull();
  });
});

// フォールバックは shouldRunClaudeJudge の第2引数を経由して judge の発火条件にも触る。
// 【シナリオ】を持つキャラはほぼ全員なので、素通しすると全キャラの全会話ターンへ
// judge の課金呼び出しが1発ずつ増える。source で切り分けたことをここで固定する。
describe("【シナリオ】由来の場面は Claude judge を起こさん", () => {
  it("素の sceneName を渡すと conversation でも judge が回ってしまう(切り分けが要る根拠)", () => {
    const memo = resolveSceneConstraintMemo([], SAKURA_SCENARIO_PROMPT);
    expect(shouldRunClaudeJudge("conversation", memo?.sceneName)).toBe(true);
  });

  it("resolveJudgeSceneName が【シナリオ】由来を undefined へ落とし、conversation の judge が回らん", () => {
    const memo = resolveSceneConstraintMemo([], SAKURA_SCENARIO_PROMPT);
    expect(resolveJudgeSceneName(memo)).toBeUndefined();
    expect(shouldRunClaudeJudge("conversation", resolveJudgeSceneName(memo))).toBe(false);
  });

  it("明示宣言された舞台(#1383の前提)は従来どおり judge を回す", () => {
    const memo = resolveSceneConstraintMemo([], CLASSROOM_SCENARIO_PROMPT);
    expect(resolveJudgeSceneName(memo)).toBe("教室");
    expect(shouldRunClaudeJudge("conversation", resolveJudgeSceneName(memo))).toBe(true);
  });

  it("erotic/climax は sceneName に関係なく従来どおり judge を回す", () => {
    expect(shouldRunClaudeJudge("erotic", undefined)).toBe(true);
    expect(shouldRunClaudeJudge("climax", undefined)).toBe(true);
  });
});

// ── ここから /api/chat 実経路: augmentMessages に渡った後、実際に組み立てられる
// directive に ABSOLUTE_SCENE_REINFORCEMENT が現れるかを検証する。
// アイデア/D1モックは functions/api/__tests__/phase-de-escalation-overlap.test.ts の
// makeSlowD1Mock (character 行を返す D1 モック) を踏襲する。

const AUTH_TOKEN = "test-token";
const CHARACTER_ID = "char-sakura";

// drizzle-orm の D1 セッションは列マッピング付き select を .raw() 経由で読む
// (fields が立つと .all() 内部が値配列を要求する values()/.raw() 経路へ回る)。
// そのため D1 モックは "select "col1","col2" from "character" ..." の列並びを見て、
// その並び順どおりの値配列を返す必要がある(単純にキー付きオブジェクトを返すだけでは
// drizzle 側のマッピングに載らず空扱いになる)。
const CHARACTER_ROW: Record<string, unknown> = {
  id: CHARACTER_ID,
  name: "さくら",
  gender: null,
  greeting: "初めまして。",
  system_prompt: SAKURA_SCENARIO_PROMPT,
  avatar: null,
  user_persona_name: null,
  user_persona_gender: null,
  user_persona_personality: null,
};

const parseSelectedCharacterColumns = (sql: string): string[] => {
  const match = sql.match(/^select\s+([\S\s]*?)\s+from\s+"character"/i);
  if (!match) return [];
  return match[1].split(",").map((col) => col.trim().replace(/^"|"$/g, ""));
};

const makeCharacterD1Mock = () => ({
  prepare: (sql: string) => {
    // memory_note 等の他テーブル select は列名が拾えず空のまま(意図どおり)。
    const columns = parseSelectedCharacterColumns(sql);
    const rawRow = columns.map((col) => CHARACTER_ROW[col] ?? null);
    const results = columns.length > 0 ? [rawRow] : [];
    return {
      bind: () => ({
        run: () => Promise.resolve({ success: true, meta: { changes: 0 }, results: [] }),
        all: () => Promise.resolve({ success: true, results, meta: {} }),
        first: () => Promise.resolve(null),
        raw: () => Promise.resolve(results),
      }),
    };
  },
  batch: (stmts: unknown[]) =>
    Promise.resolve(stmts.map(() => ({ success: true, meta: { changes: 1 }, results: [] }))),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

// conversation フェーズでは分岐で subtext escalation classifier(別の OpenRouter 呼び出し)も
// 走る。X-Title で「本文生成のリクエスト」だけを拾い分ける
// (phase-de-escalation-overlap.test.ts の isClassifierCall と同じ判別方法)。
const isClassifierCall = (init?: RequestInit): boolean => {
  const headers = new Headers(init?.headers);
  return (headers.get("X-Title") ?? "").includes("Classifier");
};

const captureOpenRouterFetch = () => {
  const captured: { messages: Array<{ role: string; content: string }> }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai") && !isClassifierCall(init)) {
      captured.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ error: { message: "payment required" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", stub);
  return captured;
};

const callChat = async (
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  scenePhase: "conversation" | "intimate" | "erotic" | "climax" = "conversation",
): Promise<string> => {
  const captured = captureOpenRouterFetch();
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        responseLength: "medium",
        scenePhase,
        characterId: CHARACTER_ID,
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: makeCharacterD1Mock(),
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
    },
  );

  expect(response.status).toBe(402);
  expect(captured.length).toBeGreaterThan(0);
  return captured[0].messages.map((m) => m.content).join("\n");
};

// 実測の崩壊会話: turn3「普段って、どんな本読むの」で場面が図書館へ飛んだ。
const driftTurn = { role: "user" as const, content: "普段って、どんな本読むの" };
const smallTalkTurns = [
  { role: "user" as const, content: "こんにちは、さくらさん" },
  { role: "assistant" as const, content: "あ、あの…こんにちは。よろしくお願いします。" },
  { role: "user" as const, content: "今日はいい天気だね" },
  { role: "assistant" as const, content: "そうですね、桜も綺麗に咲いてます。" },
];

describe("#(桜庭さくら 会話崩壊) 場面の強制文が短尺会話で実際に発火する", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turn3(userTurnCount=3)で【場面の連続性】ブロックが組み立て済みdirectiveに現れる", async () => {
    const sent = await callChat([
      { role: "system", content: SAKURA_SCENARIO_PROMPT },
      ...smallTalkTurns,
      driftTurn,
    ]);

    expect(sent).toContain("【場面の連続性】");
    expect(sent).toContain("桜並木");
    expect(sent).toContain("カフェ");
  });

  // 【シナリオ】は「始まりの状況」の地の文であって舞台の宣言やない。ABSOLUTE_SCENE_REINFORCEMENT
  // の「上記以外の場所を一切登場させない」を掛けると、CHAT_BASE_RULES の [ADVANCE ACCEPTANCE]
  // が受けろと言うホテルへの移動まで塞ぐ。
  it("【シナリオ】由来には移動を塞ぐ【絶対遵守】文を使わん", async () => {
    const sent = await callChat([
      { role: "system", content: SAKURA_SCENARIO_PROMPT },
      ...smallTalkTurns,
      driftTurn,
    ]);

    expect(sent).not.toContain("【絶対遵守】現在のシーン");
  });

  // 実測(2026-08-16): erotic/climax でもこの固定文を貼り続けた結果、9ターン全部が
  // カフェのテーブルと椅子のまま動かず、挿入に一度も到達せんかった。
  // 【シナリオ】は「始まりの状況」であって、行為に及べる場所とは限らん。
  it("conversation を出たら【シナリオ】由来の場面固定を出さん", async () => {
    for (const scenePhase of ["intimate", "erotic", "climax"] as const) {
      const sent = await callChat(
        [{ role: "system", content: SAKURA_SCENARIO_PROMPT }, ...smallTalkTurns, driftTurn],
        scenePhase,
      );
      expect(sent, scenePhase).not.toContain("【場面の連続性】");
    }
  });

  it("turn2(userTurnCount=2)ではまだ閾値未満で発火しない", async () => {
    const sent = await callChat([
      { role: "system", content: SAKURA_SCENARIO_PROMPT },
      ...smallTalkTurns,
    ]);

    expect(sent).not.toContain("【場面の連続性】");
  });
});
