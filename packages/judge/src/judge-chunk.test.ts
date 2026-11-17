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

describe("judgeChunk: inner の出力契約（1応答に1回・120字以内）", () => {
  const voice = { firstPerson: [], secondPerson: [], endings: [], tics: [] };
  const inner = (body: string) => `<inner>${body}</inner>`;

  it("このターン最初の inner で 120 字以内なら通る", () => {
    const result = judgeChunk(inner("わたし、もうだめ……"), {
      previousChunks: [],
      voice,
      priorInnerCount: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("ターン内 2 個目の inner は format で ng（priorInnerCount=1）", () => {
    const result = judgeChunk(inner("（また頭の中が真っ白になる……）"), {
      previousChunks: [],
      voice,
      priorInnerCount: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["format"]);
    expect(result.checks.format.reason).toContain("1 応答に 1 回");
  });

  it("120 字を超える inner は format で ng", () => {
    const result = judgeChunk(inner("あ".repeat(121)), {
      previousChunks: [],
      voice,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["format"]);
    expect(result.checks.format.reason).toContain("上限");
  });

  it("inner を含まん塊は priorInnerCount に関係なく通る", () => {
    const result = judgeChunk("<action>彼女が小さく頷いた。</action>", {
      previousChunks: [],
      voice,
      priorInnerCount: 1,
    });
    expect(result.ok).toBe(true);
  });
});

// RIT-70 NFR-2: 判定そのもの（judgeChunk）は 1 塊 50 ミリ秒以内。比較相手は FR-5 の上限どおり
// 48 個（お手本 4 + 前 6 ターン 24 + このターン 20）。CI は 4 コアを共用して時間が揺れるので
// 落とす閾値は 150 ミリ秒（50 の 3 倍）に置き、実測平均は出力に残す。
describe("judgeChunk の計測（NFR-2）", () => {
  it("48 個 × 400 字の比較相手に対して、1000 塊の判定の平均が 150ms を超えん", () => {
    // 種を 1 に固定した乱数（内容が揺れて計測がぶれんよう）。
    let seed = 1;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const POOL =
      "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセソ山川田人口手足目心男女時事";
    // 句点で 40 字ごとに区切った文（40 字の節を並べる）。
    const body = (chars: number): string => {
      let out = "";
      while (out.length < chars) {
        let clause = "";
        for (let i = 0; i < 39; i += 1) clause += POOL[Math.floor(rand() * POOL.length)];
        out += `${clause}。`;
      }
      return out.slice(0, chars);
    };
    const previousChunks = Array.from({ length: 48 }, () => body(400));
    const userText = body(200);
    const voice = extractVoice("一人称: わたし");
    const judged = Array.from({ length: 1000 }, () => body(400));

    const started = performance.now();
    for (const text of judged) {
      judgeChunk(text, { previousChunks, voice, userText });
    }
    const averageMs = (performance.now() - started) / judged.length;
    // no-console 回避で stdout 直書き（計測結果を CI ログへ残す）。
    process.stdout.write(
      `judgeChunk 1 塊あたり平均: ${averageMs.toFixed(3)}ms（n=${judged.length}, 閾値 150ms, 目標 50ms）\n`,
    );
    expect(averageMs).toBeLessThan(150);
  }, 300_000);
});
