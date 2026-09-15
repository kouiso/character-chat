import { describe, expect, it } from "vitest";

import {
  buildEncounterTensionDirective,
  ENCOUNTER_STRANGER_KEYWORDS,
  ESTABLISHED_RELATIONSHIP_KEYWORDS,
} from "./encounter-tension";

// このアプリのプロンプトはキャラ設定に無い枠（合意・境界等）を足さない
// prompt/instructions/no-injected-ai-filter.md 参照
const FORBIDDEN_FILTER_WORDS = ["合意", "同意", "セーフワード", "境界", "配慮", "倫理"] as const;

// 態度・反応の種類を決めつける語も同じ理由で禁止（0055番マイグレーションで一度パージ済みの
// パターン: 「心の葛藤」「体が先に反応する」等を形を変えて再導入せんことを固定する）。
const FORBIDDEN_ATTITUDE_WORDS = [
  "心の葛藤",
  "心の揺れ",
  "落ち着かなさ",
  "頭で考えるより先に",
  "思考が追いつく前に",
] as const;

// 「生物的な駆け引き」は身体がもう関わっとる段だけに出す点なので、共通レイヤーの
// 目印から外す。どの段でも必ず出る 3 点で当てる。
const COMMON_LAYER_MARKERS = ["状況", "雰囲気", "内面の描写"] as const;

describe("buildEncounterTensionDirective", () => {
  it("常に【出会いの空気】マーカーで始まる", () => {
    const result = buildEncounterTensionDirective("", "");
    expect(result.startsWith("\n【出会いの空気】")).toBe(true);
  });

  it("シナリオ・関係性が空でも共通レイヤーを含む非空文字列を返す", () => {
    const result = buildEncounterTensionDirective("   ", "\n");
    expect(result.trim().length).toBeGreaterThan(0);
    for (const marker of COMMON_LAYER_MARKERS) {
      expect(result).toContain(marker);
    }
  });

  it.each([
    ["ナンパされて始まった関係", ""],
    ["マッチングアプリで知り合った", ""],
    ["", "飲み会で隣になったのがきっかけ"],
    ["深夜のコンビニで声をかけられた", ""],
    ["SNSのDMから連絡を取り合うようになった", ""],
    ["今日会ったばかりだけど意気投合した", ""],
  ])(
    "出会って間もない場面 (scenario=%s, relationship=%s) は共通レイヤーと初対面向けの緊張描写を両方含む",
    (scenario, relationship) => {
      const result = buildEncounterTensionDirective(scenario, relationship);
      for (const marker of COMMON_LAYER_MARKERS) {
        expect(result).toContain(marker);
      }
      expect(result).toContain("出会った直後特有の空気感");
      expect(result).toContain("この状況ならではの身体感覚");
    },
  );

  it.each([
    ["幼馴染で昔からずっと一緒にいる", ""],
    ["", "同じ会社の同僚として長く働いている"],
    ["結婚して5年になる夫婦", ""],
    ["", "家族のように育った幼馴染同士"],
    ["結婚して5年になる夫婦が、偶然バーで再会した", ""],
    ["", "偶然の再会で、昔からの幼馴染と久しぶりに会った"],
    ["結婚して5年の夫婦が飲み会の帰りにホテルへ行く", ""],
    // 敵対レビュー #1236 指摘（4巡目）: scenarioに出会い方の記述（マッチングアプリ）が
    // 残っとっても、relationshipが現在の関係（夫婦）を明示しとれば既存関係を優先する。
    ["マッチングアプリで出会った", "結婚して5年の夫婦"],
    // 敵対レビュー #1236 指摘（6巡目）: src/data/scene-cards.ts の relationship フィールドが
    // 実際に使う語（彼女/彼氏/恋人/同棲）を含んでおらず、収録キャラでも初対面扱いのまま漏れていた。
    ["ナンパで出会った", "同棲中の彼女"],
    ["ナンパで出会った", "二人きりの温泉旅行に来た恋人"],
    ["ナンパで出会った", "同じベッドで眠る恋人"],
  ])(
    "既存の関係性 (scenario=%s, relationship=%s) は共通レイヤーのみで初対面向けの緊張描写を含まない",
    (scenario, relationship) => {
      const result = buildEncounterTensionDirective(scenario, relationship);
      for (const marker of COMMON_LAYER_MARKERS) {
        expect(result).toContain(marker);
      }
      expect(result).not.toContain("出会った直後特有の空気感");
      expect(result).not.toContain("この状況ならではの身体感覚");
    },
  );

  it("マッチングアプリ単独での一致でも「ナンパ」という文字列を含まない", () => {
    const result = buildEncounterTensionDirective("マッチングアプリで出会った", "");
    expect(result).not.toContain("ナンパ");
  });

  it.each([
    ["ナンパされて始まった関係", ""],
    ["マッチングアプリで知り合った", ""],
    ["幼馴染で昔からずっと一緒にいる", ""],
    ["結婚して5年になる夫婦", ""],
    ["", ""],
  ])(
    "出力にフィルタ文言・態度の決めつけを含まない (scenario=%s, relationship=%s)",
    (scenario, relationship) => {
      const result = buildEncounterTensionDirective(scenario, relationship);
      for (const forbidden of FORBIDDEN_FILTER_WORDS) {
        expect(result).not.toContain(forbidden);
      }
      for (const forbidden of FORBIDDEN_ATTITUDE_WORDS) {
        expect(result).not.toContain(forbidden);
      }
    },
  );
});

describe("ENCOUNTER_STRANGER_KEYWORDS", () => {
  it("キーワード一覧が空でない読み取り専用配列である", () => {
    expect(Array.isArray(ENCOUNTER_STRANGER_KEYWORDS)).toBe(true);
    expect(ENCOUNTER_STRANGER_KEYWORDS.length).toBeGreaterThan(0);
  });

  it("既存関係を表す語のいずれもキーワードに含まれない（偽陽性防止）", () => {
    const establishedPhrases = [
      "幼馴染で昔からずっと一緒にいる",
      "同じ会社の同僚として長く働いている",
      "結婚して5年になる夫婦",
    ];
    for (const phrase of establishedPhrases) {
      const matched = ENCOUNTER_STRANGER_KEYWORDS.some((keyword) => phrase.includes(keyword));
      expect(matched).toBe(false);
    }
  });

  it("「偶然」は含まれない（SITUATION_PRESETSの「偶然の再会」は既存関係を指すため）", () => {
    expect(ENCOUNTER_STRANGER_KEYWORDS).not.toContain("偶然");
  });
});

// #807系: ESTABLISHED_RELATIONSHIP_KEYWORDSの「彼女」が三人称代名詞（「彼女は」「彼女の」）まで
// 一致してしまい、地の文で「彼女」を使っただけの初対面キャラ（Sakura/ダウナー）が既存関係と
// 誤判定されていた。恋人を指す用法だけを拾う語へ分解した後の挙動を固定する。
describe("ESTABLISHED_RELATIONSHIP_KEYWORDS の「彼女」誤判定修正", () => {
  it.each([
    ["彼女は一瞬戸惑い、小さく微笑んだ。", false],
    ["彼女の部屋で二人きり", false],
    ["彼女がいるのに", true],
    ["彼女になってほしい", true],
    ["元彼女と別れて", true],
  ])("「%s」が恋人用法としてキーワード一致するか=%s", (phrase, expectedMatch) => {
    const matched = ESTABLISHED_RELATIONSHIP_KEYWORDS.some((keyword) => phrase.includes(keyword));
    expect(matched).toBe(expectedMatch);
  });

  it("三人称代名詞の「彼女」は単独では既存関係キーワードに一致しない", () => {
    expect(ESTABLISHED_RELATIONSHIP_KEYWORDS).not.toContain("彼女");
  });

  it("恋人用法（彼女がい/彼女にな/元彼女/彼女持ち）はbuildEncounterTensionDirectiveでも既存関係扱いになる", () => {
    for (const relationship of [
      "彼女がいるのに",
      "彼女になってほしい",
      "元彼女と別れて",
      "彼女持ちだと知りつつ",
    ]) {
      const result = buildEncounterTensionDirective("", relationship);
      expect(result).not.toContain("出会った直後特有の空気感");
      expect(result).not.toContain("この状況ならではの身体感覚");
    }
  });

  it("代名詞用法の「彼女は」「彼女の」を含む初対面シナリオは既存関係扱いにならず、初対面向けの緊張描写を含む", () => {
    // 「声をかけ」「今日会ったばかり」は既存の ENCOUNTER_STRANGER_KEYWORDS と組み合わせ、
    // 「彼女」の誤判定が解消され初対面判定まで正しく通ることを固定する。
    const strangerScenarioWithPronoun = buildEncounterTensionDirective(
      "声をかけると、彼女は一瞬戸惑い、小さく微笑んだ。",
      "",
    );
    expect(strangerScenarioWithPronoun).toContain("出会った直後特有の空気感");

    const strangerRelationshipWithPronoun = buildEncounterTensionDirective(
      "",
      "今日会ったばかりで、彼女の部屋で二人きりになった。",
    );
    expect(strangerRelationshipWithPronoun).toContain("出会った直後特有の空気感");
  });
});

// drizzle/0064_update_sakura_downer_persona_compressed.sql に入っとる実際の
// systemPrompt から【シナリオ】【関係性】に相当する本文を抜粋（buildEncounterTensionContext
// (functions/api/lib/route-context.ts) が実際に抽出する範囲と同じ切り出し方）。
describe("実データ回帰: Sakura(char-koharu-ex) / ダウナー(import-charap-...)", () => {
  const sakuraScenario =
    "あなたは桜並木の道でさくらに声をかけた。彼女は一瞬戸惑い、小さく微笑んだ。これからカフェに行くという誘いを受けたばかり。二人きりの時間が始まる。";
  const sakuraRelationship =
    "春の放課後、大学の正門であなたに声をかけられた。最初は警戒したが、真剣で優しい眼差しに断れなかった。カフェで話しているうちに夕方になり、帰り道の桜並木の下で「また会えますか」と早口で聞いた。自分から男の人にそんなことを言うのは初めて。誘われると嬉しくて従い、「選ばれた」と実感する。嫉妬はせず、「私でいいんですか」と不安になる。";

  const downerScenario =
    "あなたは雨に濡れてコンビニの軒下に立っていた。パーカーの女が「…うち、空いてるけど」と短く言った。気まぐれに拾われた。彼女の部屋でタオルとココアが差し出される。二人きりの雨の夜が始まる。";
  const downerRelationship =
    "雨の夜、コンビニの前で途方に暮れていたあなたを見つけた。「…うち、空いてるけど」と言った。部屋でタオルを渡しながら「…きみ、バカみたいに濡れてる」と皮肉を言う。居心地が悪くないと素を見せ、二人きりになると甘えん坊な独占欲が暴走。";

  it("Sakuraの実データは【シナリオ】【関係性】いずれもESTABLISHED_RELATIONSHIP_KEYWORDSに一致しない（彼女の誤判定が解消された）", () => {
    const matched = ESTABLISHED_RELATIONSHIP_KEYWORDS.some(
      (keyword) => sakuraScenario.includes(keyword) || sakuraRelationship.includes(keyword),
    );
    expect(matched).toBe(false);
  });

  it("Sakuraの実データは初対面向けの緊張描写を含む（修正前は「彼女」で既存関係誤判定され、この描写が丸ごと消えていた）", () => {
    const result = buildEncounterTensionDirective(sakuraScenario, sakuraRelationship);
    expect(result).toContain("出会った直後特有の空気感");
    expect(result).toContain("この状況ならではの身体感覚");
  });

  it("ダウナーの実データは【シナリオ】【関係性】いずれもESTABLISHED_RELATIONSHIP_KEYWORDSに一致しない（彼女の誤判定が解消された）", () => {
    const matched = ESTABLISHED_RELATIONSHIP_KEYWORDS.some(
      (keyword) => downerScenario.includes(keyword) || downerRelationship.includes(keyword),
    );
    expect(matched).toBe(false);
  });

  // NOTE: ダウナーの実データはESTABLISHED_RELATIONSHIP_KEYWORDSの誤判定こそ解消されるが、
  // 【シナリオ】【関係性】本文がENCOUNTER_STRANGER_KEYWORDSのどの語（「深夜のコンビニ」等）にも
  // 一致しないため、buildEncounterTensionDirectiveの出力自体は修正前後で変わらず「初対面向けの
  // 緊張描写なし」のままとなる（このテストは修正前後どちらでも green）。ENCOUNTER_STRANGER_KEYWORDS
  // の語彙不足は本タスク（「彼女」の恋人用法/代名詞用法の分解）とは別問題のため、ここでは修正せず
  // 現状の挙動を固定するだけに留める。詳細は report参照。
  it("ダウナーの実データはENCOUNTER_STRANGER_KEYWORDSに一致しないため、初対面向けの緊張描写は含まれない（別課題・現状固定）", () => {
    const result = buildEncounterTensionDirective(downerScenario, downerRelationship);
    expect(result).not.toContain("出会った直後特有の空気感");
    expect(result).not.toContain("この状況ならではの身体感覚");
  });
});
