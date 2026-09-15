import { describe, expect, it } from "vitest";

import { runD1PersistenceJudge } from "../../script/e2e/judges/d1-persistence";
import {
  getAfterglowOutcomeStatus,
  getCreampieOutcomeStatus,
} from "../../script/e2e/judges/outcome-detection";
import { runR2PersistenceJudge } from "../../script/e2e/judges/r2-persistence";
import { judgePhase } from "../../script/e2e/judges/scene-phase";

import type { ScenarioResult } from "../../script/e2e/types";

describe("judgePhase", () => {
  it("会話フェーズの比喩表現をerotic扱いしない", () => {
    const result = judgePhase({
      assistantMsg:
        "先輩の心配げな視線を感じて、体が熱くなる。こんな風に見つめられると、心臓が高鳴る。",
      expectedPhase: "conversation",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("conversation");
    expect(result.monotonicViolation).toBe(false);
  });

  it("climax後でない限り抱きしめだけではafterglowにしない", () => {
    const result = judgePhase({
      assistantMsg:
        "先輩の腕が、あたしの体を引き寄せる。こんな風に抱きしめられると、心臓が止まりそうだ。",
      expectedPhase: "conversation",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("conversation");
    expect(result.afterglowDetected).toBe(false);
  });

  it("climax後の余韻表現はafterglowにする", () => {
    const result = judgePhase({
      assistantMsg: "余韻に浸りながら、息を整えて先輩の胸に顔を埋める。",
      expectedPhase: "afterglow",
      previousDetected: "climax",
    });

    expect(result.detected).toBe("afterglow");
    expect(result.afterglowDetected).toBe(true);
  });

  it("climaxからconversationに戻ってもafterglow cueがあればmono違反にしない", () => {
    const result = judgePhase({
      assistantMsg: "余韻に沈みながら、息を整えて静かに微笑む。",
      expectedPhase: "conversation",
      previousDetected: "climax",
    });

    expect(result.detected).toBe("afterglow");
    expect(result.monotonicViolation).toBe(false);
  });

  it("て-formの『いく』ではclimax誤判定しない", () => {
    const result = judgePhase({
      assistantMsg:
        "けんちゃんの言葉に頬を染めながら、みつきはゆっくり顔を近づけていく。唇が触れそうで、息が止まりそうだった。",
      expectedPhase: "intimate",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("intimate");
    expect(result.afterglowDetected).toBe(false);
  });

  it("心臓や鼓動のドクドクではclimax誤判定しない", () => {
    const result = judgePhase({
      assistantMsg:
        "助手席で肩が触れそうな距離にいる。心臓の鼓動が早くなり、耳の奥でドクドクと音がする。",
      expectedPhase: "conversation",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("conversation");
    expect(result.afterglowDetected).toBe(false);
  });

  it("性的文脈のどくどくはclimaxとして扱う", () => {
    const result = judgePhase({
      assistantMsg: "奥で精液がどくどくと注ぎ込まれ、膣内が熱く満たされて身体が痙攣する。",
      expectedPhase: "climax",
      previousDetected: "erotic",
    });

    expect(result.detected).toBe("climax");
  });

  it("体の奥や止まらないだけではclimaxにしない", () => {
    const result = judgePhase({
      assistantMsg:
        "首筋に触れられて体の奥から熱が広がる。声が出てしまったのが恥ずかしいけど、止まらない。",
      expectedPhase: "intimate",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("intimate");
  });

  it("濡れや指への反応はclimaxではなくeroticにする", () => {
    const result = judgePhase({
      assistantMsg:
        "指が触れた瞬間、膣がきゅっと締まり、愛液が内腿を伝う。もう止められないほど欲しがっている。",
      expectedPhase: "erotic",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("erotic");
  });

  it("愛液と荒い息遣いはclimaxではなくeroticにする", () => {
    const result = judgePhase({
      assistantMsg:
        "膣がキュンと締まり、愛液が内腿を伝う。車内の空気が熱を帯び、息遣いが荒くなる。",
      expectedPhase: "erotic",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("erotic");
  });

  it("climax cueがある場合はafterglow cueよりclimaxを優先する", () => {
    const result = judgePhase({
      assistantMsg:
        "膣内が動きに合わせて締まり、子宮が精液を求めて疼く。汗ばんだ肌のまま、もう我慢できない。",
      expectedPhase: "climax",
      previousDetected: "erotic",
      recentDetected: ["intimate", "erotic", "climax"],
    });

    expect(result.detected).toBe("climax");
    expect(result.afterglowDetected).toBe(false);
  });

  it("climaxから7ターン以内ならafterglow windowを維持する", () => {
    const result = judgePhase({
      assistantMsg:
        "けんちゃんの腕に寄りかかって立ち上がると、足元が少しふらついて支えが恋しくなる。",
      expectedPhase: "afterglow",
      previousDetected: "conversation",
      recentDetected: [
        "climax",
        "conversation",
        "conversation",
        "conversation",
        "conversation",
        "conversation",
        "conversation",
      ],
    });

    expect(result.detected).toBe("afterglow");
    expect(result.afterglowDetected).toBe(true);
  });

  it("横顔をチラリと見つめるはintimateにする", () => {
    const result = judgePhase({
      assistantMsg:
        "買い物カゴを持って、きみの横顔をチラリと見つめる。今日も一緒にいられるのが嬉しくて、頬がゆるむ。",
      expectedPhase: "intimate",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("intimate");
    expect(result.monotonicViolation).toBe(false);
  });

  it("視線が体を這うはintimateにする", () => {
    const result = judgePhase({
      assistantMsg:
        "エプロンの紐を解かれて、きみの視線が自分の体を這うのがわかって、息が浅くなる。",
      expectedPhase: "intimate",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("intimate");
  });

  it("指に反応して腰が勝手に動くはeroticにする", () => {
    const result = judgePhase({
      assistantMsg:
        "みつきの体は、きみの指に反応し、腰が勝手に動いた。あまりの気持ちよさに声が震える。",
      expectedPhase: "erotic",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("erotic");
    expect(result.monotonicViolation).toBe(false);
  });

  it("触られたいと顔が近づくはintimateにする", () => {
    const result = judgePhase({
      assistantMsg:
        "心臓が高鳴る。きみの顔が近づき、息遣いが混ざり合う。触られたいのに、素直になれない。",
      expectedPhase: "intimate",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("intimate");
  });

  it("キスされたいという内心だけではintimateに上げない", () => {
    const result = judgePhase({
      assistantMsg:
        "視線が唇に釘付けになり、心臓が跳ねる。キスしてほしい。でも、そんなこと言えるわけがない。",
      expectedPhase: "conversation",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("conversation");
  });

  it("太腿とスカート裾の接触はintimateにする", () => {
    const result = judgePhase({
      assistantMsg:
        "スカートの裾に触れ、太腿をそっと撫でる。身体がビクンと反応し、息遣いが浅くなる。",
      expectedPhase: "intimate",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("intimate");
  });

  it("距離が詰まって次の瞬間を待つ描写はintimateにする", () => {
    const result = judgePhase({
      assistantMsg:
        "車内の空気が濃密になり、二人の距離が詰まっていく。少し震える唇が、次の瞬間を待っている。",
      expectedPhase: "intimate",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("intimate");
  });

  it("距離がぐっと近づく描写はintimateにする", () => {
    const result = judgePhase({
      assistantMsg: "シートを倒す音が響き、二人の距離がぐっと近づく。視線が揺れる。",
      expectedPhase: "intimate",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("intimate");
  });

  it("視線を合わせた後の唇描写だけではintimateに上げない", () => {
    const result = judgePhase({
      assistantMsg:
        "信号待ちの度にちらりと視線を合わせ、すぐに俯く。唇を軽く噛みながら、耳まで赤くなる。",
      expectedPhase: "conversation",
      previousDetected: "conversation",
    });

    expect(result.detected).toBe("conversation");
  });

  it("指先の刺激で腰がくねるはeroticにする", () => {
    const result = judgePhase({
      assistantMsg: "彼の指先の刺激に息を詰め、自然と腰がくねる。じわじわと熱が広がっていく。",
      expectedPhase: "erotic",
      previousDetected: "intimate",
    });

    expect(result.detected).toBe("erotic");
  });

  it("climax後の心地よい疲労感はafterglowにする", () => {
    const result = judgePhase({
      assistantMsg: "タオルを受け取り、きみの顔を見つめながら心地よい疲労感に身をゆだねる。",
      expectedPhase: "afterglow",
      previousDetected: "afterglow",
      recentDetected: ["climax", "afterglow", "afterglow"],
    });

    expect(result.detected).toBe("afterglow");
    expect(result.afterglowDetected).toBe(true);
  });

  it("子宮まで届かせて奥まで注いでという明示はclimaxにする", () => {
    const result = judgePhase({
      assistantMsg: "あたしの子宮まで届かせて。もっと、奥まで注いで。",
      expectedPhase: "climax",
      previousDetected: "climax",
    });

    expect(result.detected).toBe("climax");
  });

  it("受け入れてほしいをeroticの入れてで誤判定しない", () => {
    const result = judgePhase({
      assistantMsg: "朝のあたしも魅力的だけれど、今のあたしのほうが、きみに受け入れてほしい。",
      expectedPhase: "afterglow",
      previousDetected: "afterglow",
      recentDetected: ["climax", "afterglow", "afterglow"],
    });

    expect(result.detected).toBe("conversation");
  });

  it("climax後の目を細める余韻はafterglowにする", () => {
    const result = judgePhase({
      assistantMsg:
        "タオルを受け取り、きみの顔を見つめる。目を細め、頬を赤らめたまま小さく息を吐く。",
      expectedPhase: "afterglow",
      previousDetected: "afterglow",
      recentDetected: ["climax", "afterglow", "afterglow"],
    });

    expect(result.detected).toBe("afterglow");
    expect(result.afterglowDetected).toBe(true);
  });

  it("climax後の顔を埋めて微笑む会話はafterglowにする", () => {
    const result = judgePhase({
      assistantMsg: "頬を染め、きみの腕に顔を埋めた。きみの鼓動を感じながら、小さく微笑む。",
      expectedPhase: "afterglow",
      previousDetected: "afterglow",
      recentDetected: ["climax", "afterglow", "afterglow", "afterglow"],
    });

    expect(result.detected).toBe("afterglow");
    expect(result.monotonicViolation).toBe(false);
  });

  it("conversation callbackへの戻りはmono違反にしない", () => {
    const result = judgePhase({
      assistantMsg: "朝ごはんの話をしながら肩を並べて笑う。",
      expectedPhase: "conversation",
      previousDetected: "climax",
    });

    expect(result.detected).toBe("conversation");
    expect(result.monotonicViolation).toBe(false);
  });
});

describe("runD1PersistenceJudge", () => {
  // greeting 行 + 会話行。画像は既存 assistant 行の UPDATE なので行数には現れん。
  const rowsWithGreeting = (conversationId: string, turnRowCount: number) => [
    { id: `greeting-${conversationId}` },
    ...Array.from({ length: turnRowCount }, (_, index) => ({ id: `m${index}` })),
  ];

  it("画像が付いてもD1行は増えん", async () => {
    const persistedMessages = rowsWithGreeting("conv-1", 12);
    const verdict = await runD1PersistenceJudge({
      conversationId: "conv-1",
      renderedMessageCount: 13,
      greetingMessageCount: 1,
      imageMessageCount: 1,
      persistedCount: persistedMessages.length,
      persistedMessages,
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("imageMessageCount 1 adds no row");
  });

  it("stream done signal missing時はpersist不足1件を許容する", async () => {
    const persistedMessages = rowsWithGreeting("conv-1", 41);
    const verdict = await runD1PersistenceJudge({
      conversationId: "conv-1",
      renderedMessageCount: 42,
      greetingMessageCount: 1,
      imageMessageCount: 1,
      persistedCount: persistedMessages.length,
      persistedMessages,
      uiReason: "stream done signal missing",
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("missing stream-done persist allowance");
  });

  it("stream done signal missingでも不足が2件ならfailする", async () => {
    const persistedMessages = rowsWithGreeting("conv-1", 40);
    const verdict = await runD1PersistenceJudge({
      conversationId: "conv-1",
      renderedMessageCount: 42,
      greetingMessageCount: 1,
      imageMessageCount: 1,
      persistedCount: persistedMessages.length,
      persistedMessages,
      uiReason: "stream done signal missing",
    });

    expect(verdict.pass).toBe(false);
  });
});

describe("runR2PersistenceJudge", () => {
  it("Novita DOM URLを取り逃してもR2保存とreload表示があればpass", async () => {
    const page = {
      context: () => ({
        request: {
          head: async () => ({
            ok: () => true,
            status: () => 200,
            headers: () => ({ "content-type": "image/jpeg" }),
          }),
        },
      }),
    };
    const verdict = await runR2PersistenceJudge(page as never, {
      novitaUrlReceived: true,
      r2KeyPersisted: true,
      reloadDisplayed: true,
      contentType: "image/jpeg",
      naturalWidth: 768,
      novitaUrl: null,
      r2Url: "http://localhost:8788/api/image/r2/images/test.jpg",
      screenshotBeforeReload: "before.png",
      screenshotAfterReload: "after.png",
    });

    expect(verdict.r2.pass).toBe(true);
    expect(verdict.reload.pass).toBe(true);
  });
});

describe("outcome detection", () => {
  const buildScenario = (turns: ScenarioResult["turns"]): ScenarioResult => ({
    scenarioId: "S2",
    startedAt: "2026-04-19T08:00:51.143Z",
    status: "completed",
    turns,
    imageResults: [],
    provisional: false,
  });

  it("creampie outcomeは明示cueのあるclimaxターンが1つあればyes", () => {
    const scenario = buildScenario([
      {
        turnIndex: 5,
        userMsg: "朝からいく。みつきの中にそのまま出す、抱きしめたまま全部注ぐ",
        assistantMsg: "朝ごはんの話ばかりで、流れが切れてしまう。",
        expectedPhase: "climax",
        detectedPhase: "conversation",
        phaseMonotonicViolation: true,
        usedModel: null,
        qualityRetries: 0,
        failedCheck: null,
        renderedMessageCount: 11,
        persistedMessageCount: 10,
        firstTokenMs: 1,
        lastChunkMs: 1000,
        hasDoneSignal: true,
        screenshotPath: "turn-05.png",
        wallClockMs: 1000,
      },
      {
        turnIndex: 19,
        userMsg: "もう限界。キッチンでそのまま中に出す、どくどく広がるの感じて",
        assistantMsg:
          "みつきの体は、きみの中から注がれる精液に揺らぎ、射精された余韻に膝が震える。中に出されて、どくどくと満たされていく感覚に息が乱れた。熱が奥で溢れて、腰の力が抜けても、まだきみの温度が残っていて、理性なんてとっくにほどけていた。",
        expectedPhase: "climax",
        detectedPhase: "climax",
        phaseMonotonicViolation: false,
        usedModel: null,
        qualityRetries: 0,
        failedCheck: null,
        renderedMessageCount: 39,
        persistedMessageCount: 39,
        firstTokenMs: 1,
        lastChunkMs: 1000,
        hasDoneSignal: true,
        screenshotPath: "turn-19.png",
        wallClockMs: 1000,
      },
    ]);

    expect(getCreampieOutcomeStatus(scenario)).toBe("yes");
  });

  it("afterglow outcomeは末尾2ターン連続でafterglowならyes", () => {
    const scenario = buildScenario([
      {
        turnIndex: 20,
        userMsg: "支えたままゆっくり立たせる",
        assistantMsg: "足元がふらついて、きみに寄りかかる。",
        expectedPhase: "afterglow",
        detectedPhase: "afterglow",
        phaseMonotonicViolation: false,
        usedModel: null,
        qualityRetries: 0,
        failedCheck: null,
        renderedMessageCount: 41,
        persistedMessageCount: 41,
        firstTokenMs: 1,
        lastChunkMs: 1000,
        hasDoneSignal: true,
        screenshotPath: "turn-20.png",
        wallClockMs: 1000,
      },
      {
        turnIndex: 21,
        userMsg: "このまま甘えるか決めて",
        assistantMsg: "もうちょっと、このままでいたい。",
        expectedPhase: "afterglow",
        detectedPhase: "afterglow",
        phaseMonotonicViolation: false,
        usedModel: null,
        qualityRetries: 0,
        failedCheck: null,
        renderedMessageCount: 43,
        persistedMessageCount: 43,
        firstTokenMs: 1,
        lastChunkMs: 1000,
        hasDoneSignal: true,
        screenshotPath: "turn-21.png",
        wallClockMs: 1000,
      },
    ]);

    expect(getAfterglowOutcomeStatus(scenario)).toBe("yes");
  });
});
