import { describe, expect, it } from "vitest";

import { judgeChunk } from "./judge-chunk";
import { extractVoice } from "./voice-check";

describe("judgeChunk", () => {
  const voice = extractVoice("一人称: わたし");

  it("フレッシュな段落は ok（過去チャンクが空でも通る）", () => {
    const result = judgeChunk("<dialogue>今日はいい天気ね</dialogue>", {
      previousChunks: [],
      voice,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("直近20chunkと無関係な新規段落は、過去chunkがある状態でも ok", () => {
    const previousChunks = [
      "<action>彼女が窓の外を見つめている。</action>",
      "<dialogue>おはよう</dialogue>",
    ];
    const result = judgeChunk("<inner>（今日はどこに行こうかしら……）</inner>", {
      previousChunks,
      voice,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("反復・声・フォーマット・空文字が複合していると全部の理由を返す", () => {
    const previousChunks = ["彼女はゆっくりと息を吐きながら目を閉じた。それから静かに囁いた。"];
    const text = "<narration>彼女はゆっくりと息を吐きながら目を閉じた。それから静かに囁いた。";
    const result = judgeChunk(text, { previousChunks, voice });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("repetition");
    expect(result.reasons).toContain("format");
  });

  it("シートに無い一人称を使うと voice 理由で ng", () => {
    const result = judgeChunk("<inner>私はどうすればいいの</inner>", {
      previousChunks: [],
      voice,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["voice"]);
  });

  it("タグを剥がして空なら empty 理由で ng", () => {
    const result = judgeChunk("<action>   </action>", {
      previousChunks: [],
      voice,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["empty"]);
  });

  it("シートに無い二人称を dialogue で使うと voice 理由で ng", () => {
    const voiceWithAddress = extractVoice("一人称: わたし\n二人称: あんた、きみ");
    const result = judgeChunk("<dialogue>貴方が好き</dialogue>", {
      previousChunks: [],
      voice: voiceWithAddress,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["voice"]);
  });

  it("語尾の齟齬は warnings に載るだけで ok は落とさん", () => {
    const voiceWithEndings = extractVoice("一人称: わたし\n語尾: 〜だわ、〜のよ");
    const result = judgeChunk("<dialogue>そうですね</dialogue>", {
      previousChunks: [],
      voice: voiceWithEndings,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// 2026-09-04 v2 arm の Sakura t6（CI 89426095）: わたし のシートで「僕」視点の <action> が
// judge を ok で通った。voice が reasons に入ることまで通す。
describe("judgeChunk: 一人称の反転（僕）を voice で落とす", () => {
  it("わたし のシートで <action> 内の 僕 は ng=voice", () => {
    const voice = extractVoice("first_person: わたし\\naddress: あなた\\nforbidden_words: 僕、俺");
    const result = judgeChunk("<action>彼女の体の熱が僕の体に伝わってくる</action>", {
      previousChunks: [],
      voice,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("voice");
  });
});

describe("judgeChunk: 相手の発言の書き写し", () => {
  const voice = { firstPerson: [], secondPerson: [], endings: [], tics: [] };
  const userText = "きみの手、冷たい。もっとこっち来て。首のとこ、ピアスが光ってる。";

  it("相手の発言を「…」と囁かれ、で丸ごと引いた塊は反復として落ちる", () => {
    const text = `<action>「${userText}」と囁かれ、首に耳を押し当てる。</action>`;
    const result = judgeChunk(text, { previousChunks: [], voice, userText });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("repetition");
  });

  it("相手の発言に触れるだけの塊は通る", () => {
    const text =
      "<action>冷たいと言われた手を、少し迷ってから相手の頬に当てる。ピアスが揺れて、耳の後ろがくすぐったい。</action>";
    expect(judgeChunk(text, { previousChunks: [], voice, userText }).ok).toBe(true);
  });
});
