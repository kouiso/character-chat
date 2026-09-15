import { describe, expect, it } from "vitest";

import {
  isXmlResponse,
  parsePartialXmlResponse,
  parseXmlResponse,
  stripRememberTags,
  stripXmlTagsStreaming,
  stripXmlTags,
  wrapConversationPlainAsXml,
} from "./xml-response-parser";

describe("parsePartialXmlResponse", () => {
  it("空文字列は空オブジェクトを返す", () => {
    expect(parsePartialXmlResponse("")).toEqual({});
  });

  it("scene の途中までをパースする", () => {
    expect(parsePartialXmlResponse("<response><scene>partial...")).toEqual({
      scene: "partial...",
    });
  });

  it("完全な scene と途中の action をパースする", () => {
    expect(parsePartialXmlResponse("<response><scene>雨の夜</scene><action>傘を")).toEqual({
      scene: "雨の夜",
      action: "傘を",
    });
  });

  it("閉じタグが欠けても次のレイヤータグを本文へ露出させない", () => {
    const partial =
      "<response><action>窓辺で手を振る<dialogue>「おかえり」</dialogue><inner>ほっとする";

    expect(parsePartialXmlResponse(partial)).toEqual({
      action: "窓辺で手を振る",
      dialogue: "「おかえり」",
      inner: "ほっとする",
    });
  });

  it("次のレイヤータグが受信途中でもタグ断片を本文へ露出させない", () => {
    expect(parsePartialXmlResponse("<response><action>手を振る<dialo")).toEqual({
      action: "手を振る",
    });
  });

  it("大文字・属性付きタグのストリーミングもレイヤーごとにパースする", () => {
    const partial = '<Response><Action mood="soft">近づく<Dialogue lang="ja">「ねえ」</Dialogue>';

    expect(parsePartialXmlResponse(partial)).toEqual({
      action: "近づく",
      dialogue: "「ねえ」",
    });
  });

  it("レイヤー内の remember は非表示にし、その後の本文は保持する", () => {
    const partial = "<response><action>近づく<remember>犬が好き</remember>手を振る</action>";

    expect(parsePartialXmlResponse(partial)).toEqual({
      action: "近づく手を振る",
    });
  });

  it("4つのレイヤーがすべて完了している場合にパースする", () => {
    const xml =
      "<response><scene>夜</scene><action>近づく</action><dialogue>「ねえ」</dialogue><inner>迷う</inner></response>";
    expect(parsePartialXmlResponse(xml)).toEqual({
      scene: "夜",
      action: "近づく",
      dialogue: "「ねえ」",
      inner: "迷う",
    });
  });

  it("リテラル \\n を実改行に正規化する", () => {
    const xml = "<response><dialogue>行1\\n行2\\n行3</dialogue>";
    expect(parsePartialXmlResponse(xml)).toEqual({
      dialogue: "行1\n行2\n行3",
    });
  });
});

describe("isXmlResponse", () => {
  it("<response>タグを含む文字列を検出する", () => {
    expect(isXmlResponse("<response><dialogue>こんにちは</dialogue></response>")).toBe(true);
  });

  it("開始タグのみはfalse", () => {
    expect(isXmlResponse("<response>こんにちは")).toBe(false);
  });

  it("大文字混じりのresponseタグも検出する", () => {
    expect(isXmlResponse("<Response><Dialogue>こんにちは</Dialogue></Response>")).toBe(true);
  });

  it("タグなしはfalse", () => {
    expect(isXmlResponse("こんにちは")).toBe(false);
  });
});

describe("parseXmlResponse", () => {
  it("dialogue + action + inner を正しくパースする", () => {
    const xml =
      "<response><action>*微笑む*</action><dialogue>「やあ」</dialogue><inner>嬉しい</inner></response>";
    const result = parseXmlResponse(xml);
    expect(result).not.toBeNull();
    expect(result?.action).toBe("*微笑む*");
    expect(result?.dialogue).toBe("「やあ」");
    expect(result?.inner).toBe("嬉しい");
  });

  it("dialogueのみでもパースできる", () => {
    const xml = "<response><dialogue>「こんにちは」</dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result).not.toBeNull();
    expect(result?.dialogue).toBe("「こんにちは」");
    expect(result?.action).toBe("");
    expect(result?.inner).toBe("");
  });

  it("dialogue がない場合は null", () => {
    const xml = "<response><action>*歩く*</action></response>";
    const result = parseXmlResponse(xml);
    expect(result).toBeNull();
  });

  it("XMLでない文字列は null", () => {
    expect(parseXmlResponse("普通のテキスト")).toBeNull();
  });

  it("response外枠が欠けても構造タグがあればパースできる", () => {
    const xml = "<action>近づく</action><dialogue>「ねえ」</dialogue><inner>迷う</inner>";
    const result = parseXmlResponse(xml);
    expect(result).not.toBeNull();
    expect(result?.action).toBe("近づく");
    expect(result?.dialogue).toBe("「ねえ」");
    expect(result?.inner).toBe("迷う");
  });

  it("narration タグもパースする", () => {
    const xml =
      "<response><dialogue>「ねえ」</dialogue><narration>彼女は振り返った</narration></response>";
    const result = parseXmlResponse(xml);
    expect(result?.narration).toBe("彼女は振り返った");
  });

  it("リテラル \\n を実改行に正規化する", () => {
    const xml =
      "<response><action>微笑んで\\n近づく</action><dialogue>「やあ」\\n「元気？」</dialogue><inner>嬉しい\\nドキドキ</inner></response>";
    const result = parseXmlResponse(xml);
    expect(result?.action).toBe("微笑んで\n近づく");
    expect(result?.dialogue).toBe("「やあ」\n「元気？」");
    expect(result?.inner).toBe("嬉しい\nドキドキ");
  });

  it("大文字混じりのXMLタグもパースする", () => {
    const xml =
      '<Response><Action mood="soft">微笑む</Action><Dialogue>「やあ」</Dialogue><Inner>嬉しい</Inner></Response>';
    const result = parseXmlResponse(xml);
    expect(result).not.toBeNull();
    expect(result?.action).toBe("微笑む");
    expect(result?.dialogue).toBe("「やあ」");
    expect(result?.inner).toBe("嬉しい");
  });

  it("単一のrememberタグを抽出しdialogueから除去する", () => {
    const xml =
      "<response><dialogue>「またカフェ行こ」<remember>ユーザーは駅前のカフェが好き</remember></dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result?.dialogue).toBe("「またカフェ行こ」");
    expect(result?.remember).toEqual(["ユーザーは駅前のカフェが好き"]);
  });

  it("action/scene/narrationタグに<remember>が混入しても除去する", () => {
    const xml =
      "<response><action>近づく<remember>ユーザーは犬好き</remember>手を伸ばす</action><dialogue>「ねえ」</dialogue><scene>夜<remember>雨の日が好き</remember>の部屋</scene><narration>彼女は<remember>誕生日は5月</remember>微笑んだ</narration></response>";
    const result = parseXmlResponse(xml);
    expect(result?.action).toBe("近づく手を伸ばす");
    expect(result?.scene).toBe("夜の部屋");
    expect(result?.narration).toBe("彼女は微笑んだ");
    expect(result?.remember).toEqual(["ユーザーは犬好き", "雨の日が好き", "誕生日は5月"]);
  });

  it("innerタグ内部に<remember>が混入していても閉じタグ後の本文を取りこぼさない", () => {
    const xml =
      "<response><dialogue>「うん」</dialogue><inner>前半の内心<remember>キャラの秘密ノート</remember>後半の内心</inner></response>";
    const result = parseXmlResponse(xml);
    expect(result?.inner).toBe("前半の内心後半の内心");
    expect(result?.remember).toEqual(["キャラの秘密ノート"]);
  });

  it("innerタグが閉じられず直後に<remember>が続く場合はrememberをinnerに含めない", () => {
    const xml =
      "<response><dialogue>「うん」</dialogue><inner>迷いながら<remember>ユーザーは犬好き</remember></response>";
    const result = parseXmlResponse(xml);
    expect(result?.inner).toBe("迷いながら");
    expect(result?.inner).not.toContain("remember");
    expect(result?.remember).toEqual(["ユーザーは犬好き"]);
  });

  it("複数のrememberタグを抽出する", () => {
    const xml = `<response><dialogue>「覚えてるよ」
<remember>ユーザーは辛い物が苦手</remember>
<remember>次は金曜の夜に話したい</remember></dialogue></response>`;
    const result = parseXmlResponse(xml);
    expect(result?.remember).toEqual(["ユーザーは辛い物が苦手", "次は金曜の夜に話したい"]);
  });

  it("rememberタグがなければ空配列", () => {
    const xml = "<response><dialogue>「おかえり」</dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result?.remember).toEqual([]);
  });

  it("閉じ > がない </inner でも inner コンテンツを抽出する", () => {
    const xml = "<response><dialogue>「やあ」</dialogue><inner>嬉しい</inner</response>";
    const result = parseXmlResponse(xml);
    expect(result).not.toBeNull();
    expect(result?.dialogue).toBe("「やあ」");
    expect(result?.inner).toBe("嬉しい");
  });

  it("</inner</response> 連結パターンでも inner を抽出する", () => {
    const xml = "<response><dialogue>「ねえ」</dialogue><inner>複雑な気持ち</inner</response>";
    const result = parseXmlResponse(xml);
    expect(result?.inner).toBe("複雑な気持ち");
  });

  // #vlong-dogfood 2026-08-16: モデルがaction/dialogueを交互に4〜10組出す実測がある。
  // blocksが無いと画面側は種別ごとに結合した2段（地の文まとめ→台詞まとめ）で描画してしまい、
  // モデルが書いた時系列が壊れる。blocksは出現順を保ったまま画面へ渡すための情報。
  it("action/dialogueが交互に並ぶ場合、出現順のblocksを返す", () => {
    const xml =
      "<response><action>近づく</action><dialogue>「ねえ」</dialogue><action>手を伸ばす</action><dialogue>「こっち」</dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result?.blocks).toEqual([
      { type: "action", text: "近づく" },
      { type: "dialogue", text: "「ねえ」" },
      { type: "action", text: "手を伸ばす" },
      { type: "dialogue", text: "「こっち」" },
    ]);
    // 種別ごとに結合した従来フィールドは互換のため維持する（品質判定・可視文字数カウント用）
    expect(result?.action).toBe("近づく\n\n手を伸ばす");
    expect(result?.dialogue).toBe("「ねえ」\n\n「こっち」");
  });

  it("blocks内の<remember>混入は除去する", () => {
    const xml =
      "<response><action>近づく<remember>犬好き</remember></action><dialogue>「ねえ」</dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result?.blocks).toEqual([
      { type: "action", text: "近づく" },
      { type: "dialogue", text: "「ねえ」" },
    ]);
  });

  // 実測 2026-08-17 phase15 霜月鈴 t7 / phase6 t6: モデルが <dialogue> を </action> で閉じた。
  // \1 で同種の閉じタグだけに一致させとると、次の本物の </dialogue> までを 1 ブロックとして
  // 呑み込む——間の <action> の地の文が、生タグごと台詞として画面へ出る。
  it("閉じタグの種別が合っとらんでも、そこでブロックを終える", () => {
    const result = parseXmlResponse(
      "<response><action>地の文A。</action><dialogue>「台詞B」</action>" +
        "<action>地の文C。</dialogue><inner>内心。</inner></response>",
    );

    expect(result?.blocks).toEqual([
      { type: "action", text: "地の文A。" },
      { type: "dialogue", text: "「台詞B」" },
      { type: "action", text: "地の文C。" },
    ]);
  });

  it("閉じタグが丸ごと無い場合も、次の開始タグでブロックを終える", () => {
    const result = parseXmlResponse(
      "<response><action>地の文A。<dialogue>「台詞B」</dialogue><inner>内心。</inner></response>",
    );

    expect(result?.blocks).toEqual([
      { type: "action", text: "地の文A。" },
      { type: "dialogue", text: "「台詞B」" },
    ]);
  });

  it("単一のaction/dialogueでもblocksを返す", () => {
    const xml = "<response><action>微笑む</action><dialogue>「やあ」</dialogue></response>";
    const result = parseXmlResponse(xml);
    expect(result?.blocks).toEqual([
      { type: "action", text: "微笑む" },
      { type: "dialogue", text: "「やあ」" },
    ]);
  });
});

describe("stripXmlTags", () => {
  it("全XMLタグを除去する", () => {
    const xml =
      "<response><action>*微笑む*</action><dialogue>「やあ」</dialogue><inner>嬉しい</inner></response>";
    const plain = stripXmlTags(xml);
    // 圏点の記号は落として語は残す。ここを通るのは読み上げ・コピー・aria-live・
    // 一覧のプレビュー・共有ページで、どれも * を表示・音読する側やない。
    expect(plain).toContain("微笑む");
    expect(plain).not.toContain("*");
    expect(plain).toContain("「やあ」");
    expect(plain).toContain("嬉しい");
    expect(plain).not.toContain("<response>");
    expect(plain).not.toContain("<dialogue>");
  });

  it("連続改行を1つにまとめる", () => {
    const input = "<response>\n\n\n<dialogue>test</dialogue>\n\n</response>";
    const result = stripXmlTags(input);
    expect(result).not.toMatch(/\n{2,}/);
  });

  it("大文字混じりや属性付きのXMLタグも除去する", () => {
    const input = '<Response><Dialogue data-kind="main">「了解」</Dialogue></Response>';
    expect(stripXmlTags(input)).toBe("「了解」");
  });
});

describe("stripRememberTags", () => {
  it("rememberタグだけを除去する", () => {
    const result = stripRememberTags("「了解」<remember>次は海に行きたい</remember>");
    expect(result).toBe("「了解」");
  });
});

describe("stripXmlTagsStreaming", () => {
  it("完全なXMLタグを除去する", () => {
    expect(stripXmlTagsStreaming("<response><narration>hello</narration></response>")).toBe(
      "hello",
    );
  });

  it("未完了の開始タグを除去する", () => {
    const result = stripXmlTagsStreaming("<response>\n<narratio");
    expect(result.trim()).toBe("");
    expect(result).not.toContain("<narratio");
  });

  it("短い未完了XMLタグ片も除去する", () => {
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」</")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<d")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<in")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<re")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<rem")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<remem")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」<remember")).toBe("「了解」");
    expect(stripXmlTagsStreaming("<response><dialogue>「了解」</rem")).toBe("「了解」");
  });

  it("タグ内のストリーミング途中コンテンツは保持する", () => {
    expect(stripXmlTagsStreaming("<response><narration>hel")).toBe("hel");
  });

  it("rememberタグを除去する", () => {
    expect(stripXmlTagsStreaming("「了解」<remember>次は海に行きたい</remember>")).toBe("「了解」");
  });

  it("受信中の未完了rememberタグ本文を表示しない", () => {
    expect(stripXmlTagsStreaming("「了解」<remember>次は海に行きたい")).toBe("「了解」");
  });

  it("大文字混じりのXMLタグもストリーミング表示から除去する", () => {
    expect(stripXmlTagsStreaming("<Response><Dialogue>「了解」</Dialogue></Response>")).toBe(
      "「了解」",
    );
  });

  it("空文字列は空文字列のまま返す", () => {
    expect(stripXmlTagsStreaming("")).toBe("");
  });

  it("<thinking>タグとコンテンツを除去する", () => {
    expect(stripXmlTagsStreaming("<thinking>推論テキスト</thinking>こんにちは")).toBe("こんにちは");
  });

  it("<analysis>タグとコンテンツを除去する", () => {
    expect(stripXmlTagsStreaming("<analysis>分析内容</analysis>世界")).toBe("世界");
  });

  it("末尾の未完了<thinking>ブロックを除去する", () => {
    expect(stripXmlTagsStreaming("こんにちは<thinking>途中")).toBe("こんにちは");
  });

  it("不明タグ（タグのみ）を除去する", () => {
    expect(stripXmlTagsStreaming("<custom>表示される</custom>")).toBe("表示される");
  });

  it("末尾の不完全不明タグを除去する", () => {
    expect(stripXmlTagsStreaming("こんにちは<unknown")).toBe("こんにちは");
  });

  it("<3 は数字なので除去しない", () => {
    expect(stripXmlTagsStreaming("x <3 y")).toBe("x <3 y");
  });
});

describe("wrapConversationPlainAsXml", () => {
  it("プレーンテキストを<response><dialogue>でラップする", () => {
    const result = wrapConversationPlainAsXml("「こんにちは」");
    expect(result).toBe("<response><dialogue>「こんにちは」</dialogue></response>");
  });

  it("すでにXMLの場合はそのまま返す", () => {
    const xml = "<response><dialogue>「やあ」</dialogue></response>";
    expect(wrapConversationPlainAsXml(xml)).toBe(xml);
  });

  it("空文字列はそのまま返す", () => {
    expect(wrapConversationPlainAsXml("")).toBe("");
  });

  it("裸の<dialogue>タグを救済する", () => {
    const input = "<dialogue>「こんにちは」</dialogue>";
    const result = wrapConversationPlainAsXml(input);
    expect(result).toBe("<response><dialogue>「こんにちは」</dialogue></response>");
  });

  it("大文字混じり属性付きの裸<dialogue>タグも救済する", () => {
    const input = '<Dialogue tone="soft">「こんにちは」</Dialogue>';
    const result = wrapConversationPlainAsXml(input);
    expect(result).toBe("<response><dialogue>「こんにちは」</dialogue></response>");
  });
});

describe("stripXmlTags — unknown tag catch-all", () => {
  it("<thinking>タグとコンテンツを除去する", () => {
    expect(stripXmlTags("<thinking>内部推論</thinking>表示テキスト")).toBe("表示テキスト");
  });

  it("不明タグ（タグのみ）を除去する", () => {
    expect(stripXmlTags("<custom>コンテンツ</custom>")).toBe("コンテンツ");
  });
});

describe("stripXmlTags — truncated tag tolerance", () => {
  it("閉じ > がない切り詰め </inner を除去する", () => {
    expect(stripXmlTags("彼女は微笑んだ</inner")).toBe("彼女は微笑んだ");
  });

  it("閉じ > がない切り詰め </response を除去する", () => {
    expect(stripXmlTags("<response><dialogue>やあ</dialogue></response")).toBe("やあ");
  });

  it("部分タグ名 </inn を除去する", () => {
    expect(stripXmlTags("本文</inn")).toBe("本文");
  });

  it("部分タグ名 </dial を除去する", () => {
    expect(stripXmlTags("本文</dial")).toBe("本文");
  });

  it("文字列途中の </inner に続くテキストを誤って消費しない（greedy回帰）", () => {
    // </inner の後にテキストが続く場合はタグだけを除去してテキストを保持
    // 実際には発生しないがregexの安全確認
    expect(stripXmlTags("<response><inner>内心</inner>地の文</response>")).toBe("内心地の文");
  });
});

describe("parsePartialXmlResponse の blocks（D14: ストリーミング中に本文の大半が出ん）", () => {
  // PARTIAL_LAYER_PATTERNS は /g を持たんので .match() が最初の 1 個しか返さん。
  // very_long/erotic は <action>/<dialogue> を交互に並べる指示なので、生成中は
  // 本文の大半が画面に出ず、ストリーム終了の瞬間に DOM が一気に組み替わる。
  // 種別が 1 回ずつなら従来のフォールバックで全部出とるので blocks は出さん
  // （出すと her-message.tsx の blocks 分岐へ落ちてタイプライタ表示が死ぬ）。
  it("同じタグが 2 回以上出たら出現順の blocks を返す", () => {
    const partial =
      "<response><action>段落1の地の文</action><dialogue>「せりふ1」</dialogue>" +
      "<action>段落2の地の文</action><dialogue>「せりふ2」</dialogue><action>段落3の地の文（まだ";

    expect(parsePartialXmlResponse(partial).blocks).toEqual([
      { type: "action", text: "段落1の地の文" },
      { type: "dialogue", text: "「せりふ1」" },
      { type: "action", text: "段落2の地の文" },
      { type: "dialogue", text: "「せりふ2」" },
      { type: "action", text: "段落3の地の文（まだ" },
    ]);
  });

  it("種別が 1 回ずつなら blocks を返さん（タイプライタ表示を残す）", () => {
    const partial = "<response><action>地の文</action><dialogue>「せりふ」";

    expect(parsePartialXmlResponse(partial).blocks).toBeUndefined();
  });
});
