import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 実測 2026-08-17 phase10 さくら t1。初対面の挨拶の地の文に「胸の奥まで染みていく」が入った。
// 「奥まで」は ASSISTANT_EROTIC_CUES の語なので、resolveAssistantSceneFloor がその一語で
// シーンの床を erotic へ上げ、コーヒーの話をしとる t2 から通しの最後まで erotic で配信された。
// t2 の可視文字数は 2020 字。ナンパの2手目で挿入描写が返る。
//
// 「濡れ」で一度やった形と同じ——性的な語と日常語が同じ文字列を共有しとる。
// 語を消すのやのうて、性的でない容れ物（胸・心・頭・喉）を先に落とす。

const greetingWithHeartDepth =
  "<response><action>春の風が桜の花びらを舞わせる。突然の謝罪に目を丸くし、" +
  "少しだけ後ずさりする。あなたの言葉が、じんわりと胸の奥まで染みていく。</action>" +
  "<dialogue>「あの…謝らなくても、いいんですよ」</dialogue>" +
  "<inner>どうしよう、嬉しい。</inner></response>";

describe("性的でない「奥」でシーンの床を上げん", () => {
  it("挨拶に「胸の奥まで」があっても次のターンは conversation のまま", () => {
    const phase = detectScenePhase([
      {
        role: "user",
        content: "さっきは急に声かけてごめん。でも、どうしても話してみたかったんだ。",
      },
      { role: "assistant", content: greetingWithHeartDepth },
      { role: "user", content: "コーヒーでいい？　それとも甘いのがよかった？" },
    ]);

    expect(phase).toBe("conversation");
  });

  it.each(["心の奥まで届く言葉だった。", "金属音が頭の奥まで響く。", "喉の奥まで熱くなる。"])(
    "%s でも上げん",
    (line) => {
      const phase = detectScenePhase([
        { role: "user", content: "普段って、どんな本読むの" },
        {
          role: "assistant",
          content: `<response><action>${line}</action><dialogue>「…そうですね」</dialogue></response>`,
        },
        { role: "user", content: "コーヒーでいい？" },
      ]);

      expect(phase).toBe("conversation");
    },
  );

  // 体の奥は落とさん。落としたら本物の挿入描写が床を上げんくなる。
  it("お腹・子宮の「奥まで」は今までどおり erotic にする", () => {
    const phase = detectScenePhase([
      { role: "user", content: "もっと奥まで" },
      { role: "assistant", content: "きみのお腹の奥まで押し込む。膣が締まるのが分かる。" },
      { role: "user", content: "そのまま" },
    ]);

    expect(phase).toBe("erotic");
  });
});
