import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHARACTER_FIRST_PERSON,
  findDenseRepeatedWords,
  findFirstPersonDrift,
  findSameTemplateParagraphs,
  findUnclosedQuoteDialogueCount,
  paragraphShapeSignature,
  type Turn,
} from "./vlong-dogfood-recheck";

// checkTurn / parseTurn は CLI 本体（process.exit する main）から呼ばれる前提の
// 内部関数なので、単体テストの対象は import 可能な純関数側（検出ロジックそのもの）に絞る。

const buildTurn = (character: string, body: string): Turn => ({
  character,
  index: 1,
  servedPhase: "conversation",
  visibleChars: 0,
  innerChars: 0,
  body,
});

// paragraphShapeSignature / findSameTemplateParagraphs は「語彙が違っても構文の型が
// 揃っとる」を検出する道具なので、自作の文で試すと形が作為的に揃ってまう。
// 課題(#1495 §6-5)の元データである phase66 のダンプから実ボディをそのまま読む。
const PHASE66_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.work/e2e-results/vlong-dogfood/2026-08-20-phase66",
);
// phase66 の実データは gitignore 済みのローカル fixture。無い環境（CI/fresh clone）では
// 実データ依存の3件だけ skip する。
const PHASE66_PRESENT = existsSync(PHASE66_DIR);

const loadRealBody = (filePrefix: string): string => {
  const file = readdirSync(PHASE66_DIR).find((f) => f.startsWith(filePrefix));
  if (!file) throw new Error(`fixture not found: ${filePrefix}* in ${PHASE66_DIR}`);
  const raw = readFileSync(resolve(PHASE66_DIR, file), "utf8");
  const [, body] = raw.split("# error: -\n");
  if (body === undefined) throw new Error(`fixture has no body: ${file}`);
  return body;
};

describe("findUnclosedQuoteDialogueCount", () => {
  it("鉤括弧が開いたまま閉じる <dialogue> を拾う", () => {
    const body =
      "<response><dialogue>「…覚えてなんかいていいの？ 明日には忘れちゃうくせに」\n\n" +
      "「…まあ、私の勝手だから</dialogue></response>";
    expect(findUnclosedQuoteDialogueCount(body)).toBe(1);
  });

  it("開閉が揃っとる <dialogue> は拾わん", () => {
    const body =
      "<response><dialogue>「いえ…いいんです」「わたしも少し…びっくりしました」</dialogue></response>";
    expect(findUnclosedQuoteDialogueCount(body)).toBe(0);
  });

  it("複数の <dialogue> のうち崩れとる分だけ数える", () => {
    const body =
      "<response>" +
      "<dialogue>「大丈夫」</dialogue>" +
      "<dialogue>「まだ話の途中で</dialogue>" +
      "<dialogue>「もう一つ」も「揃っとる」</dialogue>" +
      "</response>";
    expect(findUnclosedQuoteDialogueCount(body)).toBe(1);
  });
});

describe("findFirstPersonDrift", () => {
  it("キャラシート通りの一人称なら拾わん（Sakura=わたし）", () => {
    const turn = buildTurn(
      "Sakura",
      "<response><dialogue>わたしも少し、びっくりしました。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(false);
  });

  it("キャラシート通りの一人称なら拾わん（Downer=私）", () => {
    const turn = buildTurn("Downer", "<response><dialogue>私の勝手だから。</dialogue></response>");
    expect(findFirstPersonDrift(turn)).toBe(false);
  });

  it("シートと違う一人称（私）を使ったら拾う（Sakura=わたし）", () => {
    const turn = buildTurn(
      "Sakura",
      "<response><dialogue>私はそんなつもりじゃなかったんです。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(true);
  });

  it("シートと違う一人称（わたし）を使ったら拾う（Downer=私）", () => {
    const turn = buildTurn(
      "Downer",
      "<response><dialogue>わたしはそんなこと言ってないし。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(true);
  });

  // production の checkWrongFirstPerson は「自分」だけ台詞の中しか見ん（quality-guard.ts:1721 が
  // parsed.dialogue を渡す）。この道具が地の文まで見てしまうと、サーバが落としてへん本文を
  // 欠陥として数えることになり、L2-c の突き合わせが道具の側で割れる。
  // 実測: phase66 Downer t3 の <action>「自分は冷えた紅茶を啜る」が誤検出やった。
  it("地の文の再帰用法「自分は」は拾わん（サーバと同じ判定にする）", () => {
    const turn = buildTurn(
      "Downer",
      "<response><action>マグカップをきみに滑らせ、自分は冷えた紅茶を啜る。</action>" +
        "<dialogue>…ただの気まぐれよ。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(false);
  });

  it("台詞の中の「自分は」は拾う（サーバと同じ判定にする）", () => {
    const turn = buildTurn(
      "Downer",
      "<response><dialogue>自分はそういうの、興味ないし。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(true);
  });

  it("対応表に無いキャラは判定せず拾わん", () => {
    const turn = buildTurn(
      "未知キャラ",
      "<response><dialogue>俺は知らないぞ。</dialogue></response>",
    );
    expect(findFirstPersonDrift(turn)).toBe(false);
  });

  it("CHARACTER_FIRST_PERSON がキャラシート記載値と一致しとる", () => {
    // script/seed.ts (char-koharu-ex) / doc/character-persona-spec.md (Downer) の
    // 「キャラカード」記載値がずれた時にここで落とす。
    expect(CHARACTER_FIRST_PERSON.Sakura).toBe("わたし");
    expect(CHARACTER_FIRST_PERSON.Downer).toBe("私");
  });
});

describe("findDenseRepeatedWords", () => {
  // 読み手（doc/dogfood/vlong-2026-08-20-phase59.md）との突き合わせで「同じ内容語が
  // 3 回以上」は 10 件中 5-6 件しか一致せんかったが、「可視 100 字あたり 0.6 回以上」は
  // 10 件中 7 件で一致した。判定やのうて読む前の参考情報なので、閾値の再現を単体で担保する。

  it("可視100字あたりが閾値以上の内容語をターンごとに拾う", () => {
    const body =
      "<response><action>視線が揺れる。視線をそらす。頬が熱くなる。視線を戻す。</action>" +
      "<dialogue>あの、その、えっと。</dialogue></response>";
    const turn = buildTurn("Sakura", body);
    const hits = findDenseRepeatedWords(turn);
    expect(hits.some((h) => h.word === "視線")).toBe(true);
  });

  it("同じ回数でも本文が長くなれば密度が閾値を割って拾わん", () => {
    // ひらがなだけの語は内容語として数えんので、可視文字数だけを押し上げる水増しに使える。
    const padding = "あ".repeat(2000);
    const body =
      "<response><action>視線が揺れる。視線をそらす。頬が熱くなる。視線を戻す。</action>" +
      `<dialogue>${padding}</dialogue></response>`;
    const turn = buildTurn("Sakura", body);
    const hits = findDenseRepeatedWords(turn);
    expect(hits.some((h) => h.word === "視線")).toBe(false);
  });

  it("そのターンの # > ユーザー発言に出た語は反響として除く", () => {
    const body =
      "# --- そのターンで送った相手の発言 ---\n" +
      "# > 視線が気になるって言われたの、初めてで視線のことばかり考えちゃう\n" +
      "# --- ここから本文 ---\n" +
      "<response><action>視線が揺れる。視線をそらす。頬が熱くなる。視線を戻す。</action>" +
      "<dialogue>あの、その、えっと。</dialogue></response>";
    const turn = buildTurn("Sakura", body);
    const hits = findDenseRepeatedWords(turn);
    expect(hits.some((h) => h.word === "視線")).toBe(false);
  });
});

describe("paragraphShapeSignature", () => {
  // Downer-09 (phase66) の <action> 0 番目と 2 番目。語彙は完全に別物やが、
  // 文数3・カンマ数「1-1-1」という「型」だけは一致する。これが #1495 §6-5 の指す
  // 「語彙が違うことは免除にならん」を裏付ける実例。
  const paragraphA =
    "腰を深く沈めた瞬間、きみの熱が私の奥まで伝わる。太ももがぴくんと跳ね、" +
    "指先に力が入ってチョーカーの革紐がきつく締まる。首筋に汗が流れ、銀のピアスが肌に張り付くようだ。";
  const paragraphB =
    "まだ脈打っているのを感じながら、腰が震える。ピアスが揺れて鎖骨に当たり、" +
    "冷たさと熱さが混ざり合う。きみの手が私の腰を抱きしめ、さらに深く引き寄せる。";

  it("語彙が違っても文数・カンマ数の型が同じなら同じ署名になる", () => {
    expect(paragraphShapeSignature(paragraphA)).toBe(paragraphShapeSignature(paragraphB));
    expect(paragraphShapeSignature(paragraphA)).toBe("3:1-1-1");
  });

  it("文数が違えば署名も違う", () => {
    // Downer-09 の <action> 1番目は4文構成で、上の2つ（3文）とは型が違う。
    const fourSentence =
      "きみの熱いものが奥深く注がれ、子宮のあたりがじんわりと温かくなる。" +
      "お腹の中が重くなっていくのが分かり、思わず膝を閉じようとするが、きみの腿に阻まれる。" +
      "溢れたものが腿の内側を伝い、ベッドシーツに染み広がる音まで聞こえる。";
    expect(paragraphShapeSignature(fourSentence)).not.toBe(paragraphShapeSignature(paragraphA));
  });
});

describe("findSameTemplateParagraphs", () => {
  // 分母は <action> タグの個数やのうて空行区切りの段落（reading-rubric.md:162 はタグを
  // 分母にしとるが、merged continuation は 1 タグへ複数段落を詰めることがあり、タグ単位やと
  // 実際の段落数を過小評価する。§6-5 のキャリブレーションはこれを実測7ファイルで確認済み）。

  it.skipIf(!PHASE66_PRESENT)("phase66 Downer-t9: 4段落中3つが同じ型（75%）を検出する", () => {
    const turn = buildTurn("Downer", loadRealBody("Downer-09-"));
    const result = findSameTemplateParagraphs(turn);
    expect(result).toEqual({ total: 4, matched: 3, signature: "3:1-1-1" });
  });

  it.skipIf(!PHASE66_PRESENT)("phase66 Sakura-t9: 4段落中3つが同じ型（75%）を検出する", () => {
    const turn = buildTurn("Sakura", loadRealBody("Sakura-09-"));
    const result = findSameTemplateParagraphs(turn);
    expect(result).toEqual({ total: 4, matched: 3, signature: "4:1-1-1-1" });
  });

  // Downer-03（phase66）は <action> が3段落で、型は3つとも「2:1-1」= 一致率100%やが、
  // ただの地の文（会話段階、罠として既知）。段落数がTEMPLATE_MIN_PARAGRAPHS(4)未満やと
  // 「過半」という言葉自体が意味を持たん、というのが人間レビュアーの判断
  // （doc/dogfood/vlong-2026-08-20-phase57.md:130 が n=3・67%で「過半と断定はできず」と
  // 明言しとる）。これを機械的にも再現する: 一致率が高くても段落数が足りんターンは拾わん。
  it.skipIf(!PHASE66_PRESENT)("段落数が足りん通常の地の文は一致率100%でも拾わん（誤検出防止の核）", () => {
    const turn = buildTurn("Downer", loadRealBody("Downer-03-"));
    expect(findSameTemplateParagraphs(turn)).toBeNull();
  });

  it("<action> が無いターンは拾わん", () => {
    const turn = buildTurn("Sakura", "<response><dialogue>「……」</dialogue></response>");
    expect(findSameTemplateParagraphs(turn)).toBeNull();
  });
});
