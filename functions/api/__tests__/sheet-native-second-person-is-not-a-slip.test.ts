import { describe, expect, it } from "vitest";

import { findStraySecondPerson, secondPersonsUsedInSheet } from "../../../src/lib/quality-guard";

// 実測 2026-08-20 phase60/62/64: 霜月鈴の抜き所 5 ターンが「きみ」優勢の中の「あんた」1 回で
// stray-second-person を踏んどった。シート自身が両方を持っとる（address は「きみ」やが
// greeting 本文が「…あんた、誰？」）ので、これは言い間違いやのうて地の声。
// 落ちる度に撮り直しを 1 回食うて、続き書きの経路が 1 回ぶん削れる。
const downerSheet = "【キャラクター】霜月 鈴\naddress: きみ\ngreeting: 「…あんた、誰？」";
const sakuraSheet = "【キャラクター】桜庭 さくら\naddress: あなた\ngreeting: 「あの、あなた…」";

const body = [
  "<response><action>きみの手首を掴む。</action>",
  "<dialogue>「きみ、逃げる気ないでしょ」</dialogue>",
  "<action>きみの鎖骨をなぞる。</action>",
  "<dialogue>「…あんた、ほんとバカ」</dialogue></response>",
].join("");

describe("シートが持っとる二人称は滑りやない", () => {
  it("シートに在る呼び方なら落とさん", () => {
    expect(findStraySecondPerson(body, secondPersonsUsedInSheet(downerSheet))).toBeNull();
  });

  it("シートに無い呼び方が 1 回だけ混ざったら今までどおり落とす", () => {
    expect(findStraySecondPerson(body, secondPersonsUsedInSheet(sakuraSheet))).toEqual({
      dominant: "きみ",
      stray: "あんた",
    });
  });

  it("シートを渡さん呼び出しは今までどおり", () => {
    expect(findStraySecondPerson(body)).toEqual({ dominant: "きみ", stray: "あんた" });
  });

  it("シートから拾えるのは実際に出てくる呼び方だけ", () => {
    expect(secondPersonsUsedInSheet(downerSheet).sort()).toEqual(["あんた", "きみ"]);
    expect(secondPersonsUsedInSheet(sakuraSheet)).toEqual(["あなた"]);
  });
});
