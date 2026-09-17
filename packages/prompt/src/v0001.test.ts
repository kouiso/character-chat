import { describe, expect, it } from "vitest";

import { exemplarForPhase, targetCharsForPhase } from "./exemplars";
import { composeSystemPrompt, emptyLedger, MAX_SYSTEM_CHARS, PROMPT_VERSION } from "./v0001";

import type { SceneLedger } from "./v0001";

// doc/character-persona-spec.md の Sakura 例を基にした実物形式のフィクスチャ（約 1,300 字）。
// 【キャラクター】始まり、【キャラカード】に first_person/address/speech_endings を持つ。
const SHEET = `【キャラクター】
名前: 桜庭さくら
20歳の文学部女子大生、桜庭さくら。清楚で内気だが、本心では誰かを激しく愛したい。恋愛経験は少なく、好きになると全部を捧げてしまう。一人称「わたし」、あなたへは「あなた」。語尾は「〜です」「〜ですね」「〜かな」「〜だよ」、恥ずかしい時は「〜なの」。恐れは嫌われること、欲望は選ばれて一緒にいること。

【外見】
腰まで届く蜂蜜色がかった明るい栗色のゆるいウェーブに、小さな花の髪飾り。青い瞳、色白でやわらかい肌。胸は普通くらい、優しく甘い顔立ちの二十歳前半。

【関係性】
春の放課後、大学の正門で声をかけられた。警戒したが、真剣で優しい眼差しに断れなかった。カフェで話すうち夕方になり、桜並木の下で「また会えますか」と早口で聞いた。自分から言うのは初めて。誘われると嬉しくて従い、「選ばれた」と実感する。嫉妬はせず、「私でいいんですか」と不安になる。

【シナリオ】
あなたは桜並木の道でさくらに声をかけた。さくらは一瞬戸惑い、小さく微笑んだ。これからカフェに行くという誘いを受けたばかり。二人きりの時間が始まる。

【追加設定】
口調：「あの…初めまして。桜庭さくらです。」「…あなたになら、全部、あげたいんです。」「わたし、こんなに誰かを近くに感じたの、初めてです。」服は白かクリーム色のニットにパステルスカート。困ると髪飾りに触れる、裾を指でつまむ、視線を逸らして髪を耳にかける。

【キャラクター性的特徴】
さくらにとって性は「自分を全部、あなたに捧げる儀式」。快感より、選ばれて溶けていく感覚が核心。羞恥心が高いが、それは「あなただけに見せる私」という特別感でもある。基本姿勢は献身・受け。攻めず、命令せず、所有主張せず。エスカレート：恥じらい→許し→「わたし、あなたのものにしてください」と委ねる→呑まれてしがみつく→「離れたくない」「一緒がいい」と懇願。好む：手を繋ぐ、抱かれる、耳元で囁く、甘えた泣き声。嫌う：暴力、無理やり、貶める言葉、所有主張、「気持ちいい？」。敏感帯：耳元、首筋、鎖骨、手の平、内もも／声：「あっ…」「…ん」「…だめ」「…あなた」「…離れないで」。どちらも2ターン連続で同じものを使わず、3ターン空ければ再使用可。

【キャラカード】
first_person: わたし
address: あなた
speech_endings: 〜です、〜ですね、〜かな、〜だよ、〜なの
verbal_tics: えへへ、あの…、ふふ、うん
forbidden_words: あんた、お前、僕、俺、あたし、気持ちいい、快感
sensory_focus: 桜の花びら、春の風、カフェの光、ニットの袖、花の髪飾り`;

const EXEMPLAR =
  "<response><action>頬を染めてこちらを見上げる</action><dialogue>あ、あの…初めまして。桜庭さくらです。</dialogue><inner>すごくどきどきしてる</inner></response>";

describe("composeSystemPrompt", () => {
  it("PROMPT_VERSION が v0001", () => {
    expect(PROMPT_VERSION).toBe("v0001");
  });

  it("実物形式のシート(約1,300字)で上限（MAX_SYSTEM_CHARS）以内に収まる", () => {
    expect(SHEET.length).toBeGreaterThan(1000);
    expect(SHEET.length).toBeLessThan(1600);

    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system.length).toBeLessThanOrEqual(MAX_SYSTEM_CHARS);
  });

  it("出力形式に本人の一人称視点の指示が入る（2026-09-05 v2 arm: 「さくらは…」の小説調で視点が外れた）", () => {
    const system = composeSystemPrompt({
      sheet: "一人称: わたし",
      name: "桜庭 さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 220,
      exemplar: "<response><action>x</action><dialogue>y</dialogue><inner>z</inner></response>",
    });
    expect(system).toContain("桜庭 さくら 本人が体験する一人称視点で書く");
    expect(system).toContain("相手の発言をそのまま書き写さん");
  });

  it("分量は目安やのうて下限で書く（2026-09-05 deepseek-v3.2: 「おおよそ 350 字」で 74〜130 字が返った）", () => {
    const system = composeSystemPrompt({
      sheet: "一人称: わたし",
      name: "桜庭 さくら",
      ledger: emptyLedger(),
      phase: "intimate",
      targetChars: 350,
      exemplar: "<response><action>x</action><dialogue>y</dialogue><inner>z</inner></response>",
    });
    expect(system).toContain("350 字以上、700 字まで");
    expect(system).not.toContain("おおよそ");
  });

  it("dropMinChars なら下限強制（字以上）を落として上限（字まで）だけ残す", () => {
    const system = composeSystemPrompt({
      sheet: "一人称: わたし",
      name: "桜庭 さくら",
      ledger: emptyLedger(),
      phase: "intimate",
      targetChars: 350,
      exemplar: "<response><action>x</action><dialogue>y</dialogue><inner>z</inner></response>",
      dropMinChars: true,
    });
    expect(system).not.toContain("350 字以上");
    expect(system).toContain("700 字まで");
  });

  it("使い済みの言い回しとシートの語尾・口癖を渡すと出力形式に載る（渡さんければ載らん）", () => {
    const base = {
      sheet: "一人称: わたし",
      name: "桜庭 さくら",
      ledger: emptyLedger(),
      phase: "climax" as const,
      targetChars: 450,
      exemplar: "<response><action>x</action><dialogue>y</dialogue><inner>z</inner></response>",
    };
    const plain = composeSystemPrompt(base);
    expect(plain).not.toContain("【使い済みの言い回し】");
    expect(plain).not.toContain("語尾（");
    const withHints = composeSystemPrompt({
      ...base,
      usedPhrases: ["鎖骨に歯を立て", "血の味が舌に広が"],
      voice: { endings: ["〜です", "〜なの"], tics: ["えへへ", "あの…"] },
    });
    expect(withHints).toContain("【使い済みの言い回し】");
    expect(withHints).toContain("「鎖骨に歯を立て」「血の味が舌に広が」");
    expect(withHints).toContain("語尾（〜です／〜なの）と口癖（えへへ／あの…）");
    // A2（2026-09-05）: 例示の口調を写さん・半分以上はシートの語尾で言い終える、の 2 行が声の行に続く
    expect(withHints).toContain("台詞の口調は写さん");
    expect(withHints).toContain("半分以上はシートの語尾で言い終え");
    expect(plain).not.toContain("台詞の口調は写さん");
    expect(withHints.length).toBeLessThanOrEqual(MAX_SYSTEM_CHARS);
  });

  it("キャラシートをそのまま含む（改変・要約なし）", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system).toContain(SHEET);
  });

  it("場面台帳を場所/服/体位/直前の行為/段の key: value で構造化する", () => {
    const ledger: SceneLedger = {
      phase: "intimate",
      location: "ホテルの一室",
      time: "深夜",
      present: ["さくら", "あなた"],
      clothing: { さくら: "ニット" },
      position: "ベッドの上",
      lastEvents: ["手を繋いだ", "キスをした"],
    };

    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger,
      phase: "intimate",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system).toContain("段: intimate");
    expect(system).toContain("場所: ホテルの一室");
    expect(system).toContain("服: さくら:ニット");
    expect(system).toContain("体位: ベッドの上");
    // lastEvents は直近1件だけを「直前の行為」として出す
    expect(system).toContain("直前の行為: キスをした");
  });

  it("phase 引数が ledger.phase を上書きする", () => {
    const ledger: SceneLedger = { ...emptyLedger(), phase: "conversation" };
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger,
      phase: "erotic",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });
    expect(system).toContain("段: erotic");
  });

  it("出力契約に XML 三タグ・inner は 1 回 120字以内・一人称現在形の指示を含む", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system).toContain(
      "<response><action>ト書き：場所・動作・部位・感触・音を具体的に書く</action><dialogue>台詞</dialogue><inner>内心</inner></response>",
    );
    expect(system).toContain("1 応答に 1 回だけ、120 字以内");
    expect(system).toContain("一人称・現在形");
  });

  it("渡された例示をそのまま含める", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system).toContain(EXEMPLAR);
  });

  it("セクション順（シート → 場面台帳 → 出力契約 → 例示）", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    const sheetIdx = system.indexOf(SHEET);
    const ledgerIdx = system.indexOf("【場面台帳】");
    const contractIdx = system.indexOf("【出力形式】");
    const exemplarIdx = system.indexOf("【例示】");

    expect(sheetIdx).toBeLessThan(ledgerIdx);
    expect(ledgerIdx).toBeLessThan(contractIdx);
    expect(contractIdx).toBeLessThan(exemplarIdx);
  });

  it("合意・同意・セーフワード・境界の語を含まない（no-injected-ai-filter.md）", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    for (const banned of ["合意", "同意", "セーフワード", "境界", "consent", "safeword"]) {
      expect(system).not.toContain(banned);
    }
  });

  it("ノルマ表現（必ずN文など）を含まない", () => {
    const system = composeSystemPrompt({
      sheet: SHEET,
      name: "桜庭さくら",
      ledger: emptyLedger(),
      phase: "conversation",
      targetChars: 200,
      exemplar: EXEMPLAR,
    });

    expect(system).not.toMatch(/必ず\d+文/);
  });

  it("上限（MAX_SYSTEM_CHARS）を超える場合は throw する", () => {
    const hugeSheet = "あ".repeat(3500);
    expect(() =>
      composeSystemPrompt({
        sheet: hugeSheet,
        name: "桜庭さくら",
        ledger: emptyLedger(),
        phase: "conversation",
        targetChars: 200,
        exemplar: EXEMPLAR,
      }),
    ).toThrow(new RegExp(`${MAX_SYSTEM_CHARS} 字を超えた`));
  });
});

describe("emptyLedger", () => {
  it("会話開始時の初期状態を返す", () => {
    expect(emptyLedger()).toEqual({
      phase: "conversation",
      location: null,
      time: null,
      present: [],
      clothing: {},
      position: null,
      lastEvents: [],
    });
  });
});

describe("段ごとの例示", () => {
  const phases = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

  it("全段で例示が <response> 1 個で、目安字数の 1/3 以上の本文がある（型だけの例示を許さん）", () => {
    for (const phase of phases) {
      const exemplar = exemplarForPhase(phase);
      expect(exemplar.startsWith("<response>")).toBe(true);
      expect(exemplar.match(/<response>/g)).toHaveLength(1);
      const visible = exemplar.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
      expect(visible.length).toBeGreaterThanOrEqual(targetCharsForPhase(phase) / 3);
    }
  });

  it("実シート級の 1,400 字 + 芯 + 一番長い例示 + 使い済み句 + 声の行でも上限に収まる", () => {
    const sheet = "【キャラクター】" + "あ".repeat(1_400);
    // 2026-09-05 CI 33956503097: 声の行を 2 行足したら erotic 段で 3007 字になり、さくら run1 が t7 で
    // 止まった。本番と同じ最悪形（シート 1,400 字・使い済み句 10 個 × 24 字・語尾 6 と口癖 6）で全段を通す。
    // 2026-09-17: 【プレイヤーへの約束】（芯）セクションを最悪形に足した。
    const productionSizedSheet = sheet
      .padEnd(1400, "。")
      .concat(
        "\n\n【プレイヤーへの約束】\nこの約束は【キャラクター性的特徴】より優先する。さくらは清楚で内気な二十歳。あなたという悪い男にナンパされ、言葉巧みに・執拗にアプローチされる。「悪い人じゃないかも…」と思いながら、断れず、流されるように部屋へ連れてこられる。力で無理やり、ではない——無理やり感は「押しが強くて断れない」方。悲鳴や「助けて」は上げない。同意した感じも出さない。行為が始まると体は正直で、恥ずかしいのに喜んでしまう。「いけないことをしている」という背徳感と、とてつもない快楽が同時に押し寄せる。犯されるたびに、心も犯されていく。台詞は丁寧語。崩れかけて崩れきらない: 快感で途切れるが、完全には消えない。",
      );
    const worstUsedPhrases = Array.from(
      { length: 10 },
      (_, i) => `${"使い済みの言い回し".padEnd(23, "あ")}${i}`,
    );
    const worstVoice = {
      endings: ["〜です", "〜ですね", "〜かな", "〜だよ", "〜なの", "〜ますね"],
      tics: ["えへへ", "あの…", "ふふ", "その…", "ええと", "あのね"],
    };
    for (const phase of phases) {
      const system = composeSystemPrompt({
        sheet: productionSizedSheet,
        name: "桜庭 さくら",
        ledger: emptyLedger(),
        phase,
        targetChars: targetCharsForPhase(phase),
        exemplar: exemplarForPhase(phase),
        usedPhrases: worstUsedPhrases,
        voice: worstVoice,
      });
      expect(system.length).toBeLessThanOrEqual(MAX_SYSTEM_CHARS);
    }
  });
});
