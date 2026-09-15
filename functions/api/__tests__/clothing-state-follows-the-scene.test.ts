// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildSceneStateContinuity } from "../lib/route-context";

// 服装の状態をユーザー発言からしか読んどらんかった。
// **脱がすのはキャラの地の文であって、ユーザーの発言やない。**
//
// 実測 2026-08-19（phase42 / phase44 の 40 ターン）:
//   ユーザー発言に服装語が出たターン: **0**
//   キャラ本文に服装語が出たターン: **27**
// つまり clothing= は毎ターン lastMatchInSheet に落ちて、**シートの初期衣装を返し続ける**。
// 脱いだことが状態として一度も残らんので、
//   ・脱衣の描写が 1 度も無いまま挿入・射精へ入る
//   ・一度外した服が同じターンの後半で戻る（phase42 で 2 件）
// 今朝直した場所の件（243eedb）と同じ形——シートの初期値が永久に返っとった。
//
// ユーザーの指定は今までどおり優先する。無い時にシートへ飛ばず、
// キャラ自身が最後に書いた服装を拾う。

const sheet = {
  role: "system" as const,
  content: "【キャラクター】桜庭さくら\n服装: 白いニットとパステルのスカート",
};

const turn = (role: "user" | "assistant", content: string) => ({ role, content });

describe("buildSceneStateContinuity の clothing", () => {
  it("ユーザーが服装を言うたらそれを使う（従来どおり）", () => {
    const out = buildSceneStateContinuity(
      [sheet, turn("assistant", "<action>指が肩に触れる</action>"), turn("user", "下着だけにして")],
      "erotic",
    );
    expect(out).toContain("clothing=下着");
  });

  it("ユーザーが言うてへん時、キャラが最後に書いた服装を使う", () => {
    const out = buildSceneStateContinuity(
      [
        sheet,
        turn("assistant", "<action>白いニットの袖を指でつまむ</action>"),
        turn("user", "そのまま"),
        turn("assistant", "<action>ブラのホックが外れる音が響く</action>"),
        turn("user", "つづけて"),
      ],
      "erotic",
    );
    expect(out).toContain("clothing=ブラ");
    expect(out).not.toContain("clothing=ニット");
  });

  it("どちらも言うてへん時だけシートへ落ちる", () => {
    // lastMatchInSheet はシートの**最後**の一致を返す（後ろほど今に近いという前提）。
    const out = buildSceneStateContinuity([sheet, turn("user", "つづけて")], "erotic");
    expect(out).toContain("clothing=スカート");
  });
});
