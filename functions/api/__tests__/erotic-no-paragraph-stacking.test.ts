// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  QUALITY_RETRY_HINTS,
  SCENE_CONTEXT_MESSAGES,
  buildCategoryQualityRetryHint,
} from "../lib/route-context";

// 実測（phase36・20 ターン）でブロックの組数がフェーズごとにこう割れとった:
//   conversation 2〜3 組 / intimate 3〜5 組 / erotic 1 組 / climax 1〜2 組 / afterglow 3〜4 組
// erotic と climax だけ <action> が 1 個へ潰れて、画面上 8〜13 行の地の文の壁になる。
// 台詞が末尾へまとまるので、Sakura の「丁寧な語尾が崩れきらずに残る」も Downer の悪態も
// 壁の後ろへ追いやられて、作品の芯が読めん。
//
// 原因はこの 2 フェーズにだけ入っとった段落単位の指示。「段落ごとに部位・感覚・音・動詞を
// 変えろ」は、モデルへ段落を積めと言うのと同じで、積む先は <action> しかない。
// intimate と afterglow の同じ指示は応答単位なので、その圧力が無い。
//
// 反復の禁止そのものは checkWithinTurnRepetition が本番のゲートで見とるので、
// プロンプト側から段落の語だけを外す。禁止を弱めるわけやない。

const PARAGRAPH_PRESSURE = ["every paragraph", "consecutive paragraphs"];

describe("erotic / climax の指示が段落を積ません", () => {
  it.each(["erotic", "climax"] as const)("%s に段落単位の指示が無い", (phase) => {
    const body = SCENE_CONTEXT_MESSAGES[phase] ?? "";
    expect(body).toBeTruthy();
    for (const phrase of PARAGRAPH_PRESSURE) {
      expect(body).not.toContain(phrase);
    }
  });

  // 段落の語だけを外す。反復を許す方向へ倒れたら意味が無い。
  it.each(["erotic", "climax"] as const)("%s の反復禁止そのものは残っとる", (phase) => {
    const body = SCENE_CONTEXT_MESSAGES[phase] ?? "";
    expect(body).toContain("[Anti-repetition]");
    expect(body).toContain("do not reuse the same noun, verb, adjective, or moan");
  });

  // 段落の語を落としただけの版を実測（phase38）したら、壁は 5 件 → 1 件へ減った代わりに
  // erotic / climax のフロア割れが 0 件 → 4 件へ増えた。あの一文は変化の要求と同時に
  // 「段落を積む」役もしとって、消すと長さの行き場が無くなる。
  // 積む先を段落から <action>/<dialogue> のやりとりへ移す。長さは組数で稼げば壁にならん。
  it.each(["erotic", "climax"] as const)("%s は段落やのうてやりとりを増やせと言う", (phase) => {
    const body = SCENE_CONTEXT_MESSAGES[phase] ?? "";
    expect(body).toContain("across each <action>/<dialogue> exchange");
    expect(body).toContain("add exchanges");
  });

  // 前後のフェーズは元から応答単位。ここを段落単位へ揃えたら同じ壁を作る。
  it.each(["intimate", "afterglow"] as const)("%s も段落単位にせん", (phase) => {
    const body = SCENE_CONTEXT_MESSAGES[phase] ?? "";
    for (const phrase of PARAGRAPH_PRESSURE) {
      expect(body).not.toContain(phrase);
    }
  });
});

// 壁は checkNoBodyWall が本番のゲートで拾っとって、実測 5/5 で当たっとった。
// なのに出荷されたのは、落とした後の撮り直しへ壁の話が一言も届かんかったから。
//
// 最初は QUALITY_RETRY_HINTS へキーを足しただけで直ったと思たが、実経路は
// buildCategoryQualityRetryHint を通っとって、そこは category 単位のヒントしか引かん。
// body-wall は category=repetition へ丸められるので「語彙を変えろ」しか届かんかった。
// 文字列の存在だけを見るテストやとその穴が見えん。実際に組み立てて中身を見る。
describe("壁で落ちた時に何を直すかが撮り直しへ届く", () => {
  const context = { phase: "erotic" } as const;

  it("body-wall の修正指示が在る", () => {
    const hint = QUALITY_RETRY_HINTS["body-wall"];
    expect(hint).toBeTruthy();
    expect(hint).toContain("交互");
  });

  it("撮り直しの本文へ、検出ごとの具体的な直し方が乗る", () => {
    const message = buildCategoryQualityRetryHint(
      "<response><action>あ</action></response>",
      "within-turn-repetition",
      "repetition",
      context,
      [
        { failedCheck: "within-turn-repetition", category: "repetition" },
        { failedCheck: "body-wall", category: "repetition" },
      ],
    );

    expect(message.content).toContain("不合格理由: within-turn-repetition、body-wall");
    expect(message.content).toContain("修正指示:");
    expect(message.content).toContain("積み上げないで");
  });

  // 先に落ちた検出しか名指しせんかったら、後ろの検出は何ターン重ねても直る機会が来ん。
  it("先に落ちた理由が別でも、壁の指示が消えん", () => {
    const message = buildCategoryQualityRetryHint(
      "<response><action>あ</action></response>",
      "cross-turn-repetition",
      "repetition",
      context,
      [
        { failedCheck: "cross-turn-repetition", category: "repetition" },
        { failedCheck: "body-wall", category: "repetition" },
      ],
    );

    expect(message.content).toContain("積み上げないで");
  });
});
