import { BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore, type MemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";

// 出力契約（@v2/prompt v0001）どおり <response> で包んだ形。splitChunks が包みを剥がして
// action/dialogue/inner の 3 チャンクに切ることまで含めて通す。
const VALID_XML =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";
// 2 ターン目用。判定はターンをまたいで前の本文と比べるので、1 ターン目と別の本文にしとく。
const VALID_XML_SECOND =
  "<response><action>窓を少し開けて夜風を入れる</action><dialogue>ねえ、今日はどこへ行ってたの</dialogue><inner>声が少し震えたのが悔しい</inner></response>";

const character: CharacterSheet = {
  id: "char-1",
  name: "テスト子",
  systemPrompt: "一人称: わたし\n二人称: あなた\n語尾: 「〜だよ」「〜なの」",
  greeting: "はじめまして、よろしくね",
};

// 短い fixture で判定器・保存・再生成だけを試すテストは、続きの書き足し（extend）を切っとく。
// extend 自体は末尾の 2 本で試す。
const isChunkEvent = (event: TurnEvent): event is Extract<TurnEvent, { type: "chunk" }> =>
  event.type === "chunk";

// イベントを消費するだけ（中身は見ん）。
const drain = async (events: AsyncIterable<unknown>): Promise<void> => {
  const iterator = events[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) {
    // 進めるだけ。
  }
};

const isGenerationEvent = (event: TurnEvent): event is Extract<TurnEvent, { type: "generation" }> =>
  event.type === "generation";

// 1 ターン目が store に保存され、saveTurn に渡った generation が fake model の生成内容と一致し、
// done がその id を指すこと。
const expectFirstTurnSaved = (store: MemoryTurnStore, streamed: TurnEvent[]): void => {
  const saved = store.turns.get("conv-1") ?? [];
  expect(saved).toHaveLength(1);
  expect(saved[0]?.userText).toBe("こんにちは");
  const savedEvents = saved[0]?.events ?? [];
  expect(savedEvents.filter(isChunkEvent)).toHaveLength(3);
  // 保存用 events の chunk にも preExtend が載る（persist が写す）。無いと保存側と
  // 配信側で境目の情報が食い違う。
  expect(savedEvents.filter(isChunkEvent).every((event) => event.preExtend)).toBe(true);
  const generation = savedEvents.find(isGenerationEvent);
  expect(generation).toMatchObject({
    model: "fake-list",
    promptVersion: "v0001",
    rawOutput: VALID_XML,
    status: "ok",
    request: [{ role: "user", content: "こんにちは" }],
  });
  expect(generation?.systemPrompt.length ?? 0).toBeGreaterThan(0);
  const done = streamed.find((event) => event.type === "done");
  expect(done).toMatchObject({ generationId: generation?.generationId });
};

describe("createTurnGraph", () => {
  test("token* → chunk+ → done の順でイベントが流れ、store に1ターン保存される", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [VALID_XML, VALID_XML_SECOND] });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    const stream = await graph.stream(
      { conversationId: "conv-1", userText: "こんにちは", character },
      { streamMode: "custom", configurable: { thread_id: "conv-1" } },
    );

    const events: TurnEvent[] = [];
    for await (const event of stream) {
      events.push(event as TurnEvent);
    }

    const types = events.map((event) => event.type);
    expect(types[0]).toBe("token");
    expect(types.filter((type) => type === "token").length).toBeGreaterThan(0);
    expect(types.filter((type) => type === "chunk").length).toBe(3);
    expect(types[types.length - 1]).toBe("done");

    const chunkEvents = events.filter(isChunkEvent);
    for (const chunkEvent of chunkEvents) {
      expect(chunkEvent.attempt).toBe(1);
      expect(chunkEvent.judge).toMatchObject({ ok: true });
    }

    // v2_generation 1 行分は saveTurn の events にだけ載り、SSE（stream）には流れん
    // （systemPrompt と request 丸ごとを抱えとるので配信に載せられん）。
    expect(types).not.toContain("generation");
    // その代わり turn-meta が流れる。ベンチはここから extended / truncated を読むので、
    // 流れんようになったら「書き足しを食らったターン」の記録が黙って 0 に戻る。
    expect(types).toContain("turn-meta");
    const meta = events.find(
      (event): event is Extract<TurnEvent, { type: "turn-meta" }> => event.type === "turn-meta",
    );
    expect(meta).toBeDefined();
    expect(typeof meta?.model).toBe("string");
    // turn-meta は閾値を決めた段（mechanicsPhase）と extend 前の可視字数を必ず運ぶ。
    // 運ばんくなると段ごとの集計と shortfall の対照が黙って死ぬ（2b4c1c90 と同じ型の退行）。
    // preExtendVisibleChars 25 = VALID_XML の action 14字 + dialogue 11字。
    expect(meta).toMatchObject({
      extended: 0,
      mechanicsPhase: "conversation",
      preExtendVisibleChars: 25,
    });
    // extend が走らんターンでは全塊が preExtend=true。
    expect(chunkEvents.every((chunkEvent) => chunkEvent.preExtend)).toBe(true);
    expectFirstTurnSaved(store, events);

    // 2ターン目: intake が1ターン目の履歴を読み直して history に積んどることの確認。
    const secondStream = await graph.stream(
      { conversationId: "conv-1", userText: "つぎの話をして", character },
      { streamMode: "custom", configurable: { thread_id: "conv-1" } },
    );
    await drain(secondStream);
    const savedAfterSecond = store.turns.get("conv-1");
    expect(savedAfterSecond).toHaveLength(2);
    // 前ターンの chunks が channel に残って混ざらんこと（chunk ノードでリセットしとる）。
    expect(savedAfterSecond?.[1]?.events.filter(isChunkEvent)).toHaveLength(3);
  });

  test("runTurn は graph.stream(custom) を TurnEvent の AsyncGenerator に包む", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [VALID_XML] });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    const types: string[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId: "conv-3", userText: "こんにちは", character },
      "conv-3",
    )) {
      types.push(event.type);
    }
    expect(types[0]).toBe("token");
    expect(types.filter((type) => type === "chunk")).toHaveLength(3);
    expect(types[types.length - 1]).toBe("done");
  });

  test("phase を渡すと台帳の phase が上書きされて保存される（渡さんければ台帳のまま）", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [VALID_XML, VALID_XML] });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    await drain(
      runTurn(
        graph,
        { conversationId: "conv-p", userText: "一回目", character, phase: "erotic" },
        "conv-p",
      ),
    );
    expect((await store.load("conv-p")).ledger.phase).toBe("erotic");

    await drain(
      runTurn(graph, { conversationId: "conv-p", userText: "二回目", character }, "conv-p"),
    );
    expect((await store.load("conv-p")).ledger.phase).toBe("erotic");
  });

  test("再生成予算はターンごとに戻る（同じ thread_id の 2 ターン目でも 1 回再生成できる）", async () => {
    const store = createMemoryTurnStore();
    const repeated = "とてもよく似た言い回しをそのまま繰り返す一節がここに置かれている";
    const ng = `<action>${repeated}</action><action>${repeated}</action>`;
    const repeatedSecond =
      "二度目の場面でまた同じ言い回しをそのまま並べる別の一節がここに置かれている";
    const ngSecond = `<action>${repeatedSecond}</action><action>${repeatedSecond}</action>`;
    // 1 ターン目: stream(ng) → invoke(再生成) / 2 ターン目: stream(ngSecond) → invoke(再生成)。
    // 判定はターンをまたぐので 2 ターン目は 1 ターン目と別の本文にしとく。
    const model = new FakeListChatModel({
      responses: [ng, repeated, ngSecond, repeatedSecond],
    });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    for (const userText of ["一回目", "二回目"]) {
      await drain(runTurn(graph, { conversationId: "conv-4", userText, character }, "conv-4"));
    }
    expect(invokeSpy).toHaveBeenCalledTimes(2);
  });

  test("1ターンに2つ失敗チャンクがあると、両方とも独立に1回ずつ再生成される（ターングローバルなregeneratedフラグでは2つ目が再生成されんかった）", async () => {
    const store = createMemoryTurnStore();
    const first = "同じ表現をここでひたすら繰り返す一節がこの場所に置かれている";
    const second = "まったく別の書き出しから始まる新しい一節がここに置かれていて内容も別物";
    const raw = `<action>${first}</action><action>${first}</action><action>${second}</action><action>${second}</action>`;
    const replacementForFirst = "1つ目の失敗チャンクを書き直した新しい一節がここに置かれている";
    const replacementForSecond = "窓の外で雨音が強まり、灯りが一度だけ揺れて影が伸びた";
    const model = new FakeListChatModel({
      responses: [raw, replacementForFirst, replacementForSecond],
    });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    const stream = await graph.stream(
      { conversationId: "conv-5", userText: "二重に失敗する話をして", character },
      { streamMode: "custom", configurable: { thread_id: "conv-5" } },
    );

    const events: TurnEvent[] = [];
    for await (const event of stream) {
      events.push(event as TurnEvent);
    }

    // 2つの失敗チャンク（index 1, 3）がそれぞれ1回ずつ再生成される → invoke は2回。
    expect(invokeSpy).toHaveBeenCalledTimes(2);

    const chunkEvents = events.filter(isChunkEvent);
    expect(chunkEvents).toHaveLength(4);
    expect(chunkEvents[0]?.attempt).toBe(1);
    expect(chunkEvents[1]?.attempt).toBe(2);
    expect(chunkEvents[2]?.attempt).toBe(1);
    expect(chunkEvents[3]?.attempt).toBe(2);
  });
  test("書き直しても落ちた塊は配らん: chunk イベントに出ず dropped イベントになり、保存本文にも入らん", async () => {
    const store = createMemoryTurnStore();
    const repeated = "とてもよく似た言い回しをそのまま繰り返す一節がここに置かれている";
    const ng = `<action>${repeated}</action><action>${repeated}</action>`;
    // stream(ng) → 2 つ目の <action> が反復で落ちる → invoke(書き直し) も同じ文 → 2 回目も落ちる
    const model = new FakeListChatModel({ responses: [ng, repeated] });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    const events: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId: "conv-d", userText: "一回目", character },
      "conv-d",
    )) {
      events.push(event);
    }
    const chunkSeqs = events
      .filter((e) => e.type === "chunk")
      .map((e) => (e.type === "chunk" ? e.seq : -1));
    const dropped = events.filter((e) => e.type === "dropped");
    expect(chunkSeqs).toEqual([0]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ type: "dropped", seq: 1, attempt: 2 });
    const loaded = await store.load("conv-d");
    const assistant = loaded.history.find((m) => m.role === "assistant");
    expect(assistant?.content.match(new RegExp(repeated, "g"))).toHaveLength(1);
  });

  test("お手本を写した塊は反復として落ち、書き直しが走る（お手本は直前の塊と同じ扱い）", async () => {
    const store = createMemoryTurnStore();
    const copied =
      "<action>奥の奥にどくどくと注がれる熱が止まらない。子宮が精液で満たされていく重さが下腹にずしりと広がる。</action>";
    const fresh = "窓の外で雨が強くなり、部屋の灯りが一度だけ揺れた。";
    const model = new FakeListChatModel({ responses: [copied, fresh] });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    const events: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId: "conv-e", userText: "一回目", character, phase: "climax" },
      "conv-e",
    )) {
      events.push(event);
    }
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const chunk = events.find((e) => e.type === "chunk");
    expect(chunk).toMatchObject({ type: "chunk", attempt: 2 });
  });

  test("書き直し指示は「別の言い方」ではなく「新しい出来事を一つ」を要求する", async () => {
    // 2026-09-15 実測: regen≥1 のターンだけに intra-turn 反復ループが出た（regen=0 は最大3）。
    // 「別の言い方で同じ場面を一段先へ進める」が、場面を進めず同じ動作を言い換える塊を産んでいた。
    const store = createMemoryTurnStore();
    const copied =
      "<action>奥の奥にどくどくと注がれる熱が止まらない。子宮が精液で満たされていく重さが下腹にずしりと広がる。</action>";
    const fresh = "窓の外で雨が強くなり、部屋の灯りが一度だけ揺れた。";
    const model = new FakeListChatModel({ responses: [copied, fresh] });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    for await (const event of runTurn(
      graph,
      { conversationId: "conv-i", userText: "一回目", character, phase: "climax" },
      "conv-i",
    )) {
      void event;
    }

    const messages = invokeSpy.mock.calls[0]?.[0] as BaseMessage[];
    const instruction = String(messages.at(-1)?.content);
    expect(instruction).toContain("新しい出来事");
    expect(instruction).not.toContain("別の言い方");
  });

  test("前のターンで配った塊をそのまま書いた塊は反復として落ちる（判定はターンをまたぐ）", async () => {
    const store = createMemoryTurnStore();
    // 1 ターン目も 2 ターン目も（書き直しも）同じ本文しか返さんモデル。
    const model = new FakeListChatModel({ responses: [VALID_XML] });
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    await drain(
      runTurn(graph, { conversationId: "conv-f", userText: "一回目", character }, "conv-f"),
    );
    const second: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId: "conv-f", userText: "二回目", character },
      "conv-f",
    )) {
      second.push(event);
    }
    expect(second.filter((e) => e.type === "chunk")).toHaveLength(0);
    const dropped = second.filter((e) => e.type === "dropped");
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0]).toMatchObject({ type: "dropped", reasons: ["repetition"] });
    expect(second.find((e) => e.type === "error")).toMatchObject({
      message: "全塊が判定で落ちた（配れる本文が無い）",
    });
  });

  test("生成と書き直しの呼び出しに段ごとの sampling（temperature 0.7 / top_p 0.9 / penalty）が載る", async () => {
    const store = createMemoryTurnStore();
    const repeated = "とてもよく似た言い回しをそのまま繰り返す一節がここに置かれている";
    const ng = `<action>${repeated}</action><action>${repeated}</action>`;
    const model = new FakeListChatModel({ responses: [ng, "別の場面へ進む一文がここに来る。"] });
    const streamSpy = jest.spyOn(model, "stream");
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });

    await drain(
      runTurn(
        graph,
        { conversationId: "conv-g", userText: "一回目", character, phase: "climax" },
        "conv-g",
      ),
    );
    const climax = { temperature: 0.7, topP: 0.9, frequencyPenalty: 0.25, presencePenalty: 0.62 };
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(streamSpy.mock.calls[0]?.[1]).toMatchObject({ ...climax, stop: ["</response>"] });
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy.mock.calls[0]?.[1]).toMatchObject(climax);
  });

  test("本文が目安の 8 割に届かんターンは、続きを 1 回だけ書かせて塊に足す", async () => {
    const store = createMemoryTurnStore();
    // intimate の目安 350 字に対して 40 字ほどの短い本文 → 続きを 1 回。続きは十分長くても 2 回目は無い。
    const short =
      "<response><action>窓の外で雨が強くなり、部屋の灯りが一度だけ揺れた。</action><dialogue>「……来てくれたんだ」</dialogue></response>";
    const extension =
      "<action>立ち上がって窓を閉め、濡れた肩にタオルを掛ける。指先が触れた首筋が思ったより熱い。</action><dialogue>「風邪ひくよ。そこ、座って」</dialogue>";
    const model = new FakeListChatModel({ responses: [short, extension] });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store });

    const events: TurnEvent[] = [];
    for await (const event of runTurn(
      graph,
      { conversationId: "conv-h", userText: "ただいま", character, phase: "intimate" },
      "conv-h",
    )) {
      events.push(event);
    }
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const sent = invokeSpy.mock.calls[0]?.[0];
    const last = Array.isArray(sent) ? sent[sent.length - 1] : undefined;
    const instruction = last instanceof BaseMessage ? String(last.content) : "";
    expect(instruction).toContain("350 字に足りん");
    const chunkEvents = events.filter(isChunkEvent);
    expect(chunkEvents).toHaveLength(4);
    // extend が追記した分は生の出力の末尾に付くので、先頭 2 塊（初回生成分）だけが
    // preExtend=true、書き足しの 2 塊は false。境目は N2 解析が水増し前本文を切る口。
    expect(chunkEvents.map((chunkEvent) => chunkEvent.preExtend)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const meta = events.find(
      (event): event is Extract<TurnEvent, { type: "turn-meta" }> => event.type === "turn-meta",
    );
    // extend 前の本文の可視字数（初回生成の action 25字 + dialogue 11字 = 36）。
    expect(meta).toMatchObject({
      extended: 1,
      mechanicsPhase: "intimate",
      preExtendVisibleChars: 36,
    });
    const saved = store.turns.get("conv-h")?.[0];
    expect(saved?.events.find(isGenerationEvent)?.rawOutput).toContain("風邪ひくよ");
  });

  test("本文が目安に届いとるターンは続きを書かせん", async () => {
    const store = createMemoryTurnStore();
    // conversation の目安 220 字 × 0.8 = 176 字を超える本文。
    const long = `<response><action>${"雨音が窓を叩く音を聞きながら、濡れた髪を拭く手を止めてあなたを見る。".repeat(6)}</action><dialogue>「……そんなに見ないでよ。恥ずかしいんだから」</dialogue></response>`;
    const model = new FakeListChatModel({ responses: [long] });
    const invokeSpy = jest.spyOn(model, "invoke");
    const graph = createTurnGraph({ model, store });
    await drain(
      runTurn(graph, { conversationId: "conv-i", userText: "ただいま", character }, "conv-i"),
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
