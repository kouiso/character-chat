// @vitest-environment node
// generate.ts は character-fixture 経由で node:sqlite を引く。jsdom ではバンドルでけん。
import { describe, expect, it } from "vitest";

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  accumulatePromptTokens,
  buildRunSummary,
  conditionArmOf,
  estimateCostRange,
  MAX_ATTEMPTS_PER_TURN,
  parseArgs,
  readCompletion,
  stopReasonFor,
  writeFileAtomic,
  writeJsonAtomic,
} from "./generate";

describe("bench:generate の引数", () => {
  it("既定は dry-run（--spend を明示せんと発行せん）", () => {
    expect(parseArgs([]).spend).toBe(false);
    expect(parseArgs(["--spend"]).spend).toBe(true);
  });

  it("--turns の数値の後ろにゴミが付いとったら落とす", () => {
    // parseInt が `3oops` を 3 として通すと、打ち間違いの条件のまま課金が始まる
    expect(() => parseArgs(["--turns", "3oops"])).toThrow("--turns は整数");
    expect(() => parseArgs(["--turns", "1.5"])).toThrow("--turns は整数");
    expect(parseArgs(["--turns", "3"]).turns).toBe(3);
  });

  it("継承したプロパティ名を --character として受けん", () => {
    // `in` は `constructor` や `toString` も true にする。通すと台本もキャラ id も
    // 引けんまま、関係の無い実行時エラーで落ちる
    expect(() => parseArgs(["--character", "constructor"])).toThrow("--character は");
    expect(() => parseArgs(["--character", "toString"])).toThrow("--character は");
  });

  it("台本より長い --turns を落とす", () => {
    expect(() => parseArgs(["--turns", "99"])).toThrow("台本の長さ");
    expect(() => parseArgs(["--turns", "0"])).toThrow("台本の長さ");
  });

  it("--run に . と .. を許さん", () => {
    // `.` やと run ディレクトリがコーパスの根そのものになり、loadTurnDirectories は
    // 子ディレクトリしか読まんので**課金したのに空のコーパス**になる
    expect(() => parseArgs(["--run", "."])).toThrow("--run は");
    expect(() => parseArgs(["--run", ".."])).toThrow("--run は");
    expect(() => parseArgs(["--run", "a/b"])).toThrow("--run は");
    expect(parseArgs(["--run", "smoke-1"]).run).toBe("smoke-1");
  });

  it("--max-tokens と --temperature も全体を見る", () => {
    expect(() => parseArgs(["--max-tokens", "2000oops"])).toThrow();
    expect(() => parseArgs(["--temperature", "0.9oops"])).toThrow();
  });
});

describe("条件の arm は run と別に付く", () => {
  const SHEET = "テスト用のキャラシート本文。";
  const CHARACTER = { name: "さくら", source: "migrations", systemPrompt: SHEET };
  const armOf = (argv: string[], sheet = SHEET, name = "さくら"): string =>
    conditionArmOf(parseArgs(argv), { name, systemPrompt: sheet });

  it("同じ条件を別の run で回したら arm が一致する（層が埋まる）", () => {
    // arm を `--run` と同じにしとった間、同じ条件を何本回しても run ごとに別 arm になり、
    // 層（turn × arm × 設定 × model）は n=1 のままで分位の3本・周辺率の8本へ届かんかった
    const first = buildRunSummary(parseArgs(["--run", "smoke-1"]), "1", CHARACTER, []);
    const second = buildRunSummary(parseArgs(["--run", "smoke-2"]), "2", CHARACTER, []);
    expect(first.arm).toBe(second.arm);
    expect(first.arm).not.toBe("smoke-1");
    expect(second.arm).not.toBe("smoke-2");
  });

  it("--turns が違うだけでは条件を分けん（台本は前方一致）", () => {
    expect(armOf(["--turns", "1"])).toBe(armOf(["--turns", "3"]));
  });

  it("宣言された設定が違えば arm も違う", () => {
    const base = armOf([]);
    expect(armOf(["--model", "openai/gpt-4o-mini"])).not.toBe(base);
    expect(armOf(["--max-tokens", "500"])).not.toBe(base);
    expect(armOf(["--temperature", "0.2"])).not.toBe(base);
    expect(armOf(["--character-source", "seed"])).not.toBe(base);
    expect(armOf(["--character", "downer"])).not.toBe(base);
  });

  it("表示名が変わったら arm も変わる（人格維持リマインダーへ差し込まれる）", () => {
    // buildMessagesForApi が user の 4・7・10 ターン目へ名前を入れる。
    // シートが同じでも、送っとるプロンプトが違う
    expect(armOf([], SHEET, "小春")).not.toBe(armOf([]));
  });

  it("シートの中身が変わったら arm も変わる（経路の名前だけでは足りん）", () => {
    // migration や seed がシートを書き換えた後の run が、前のシートの run と
    // 同じ層へ入っとった。経路のラベルは同じでも、送っとる物が違う
    expect(armOf([], "書き換えた後のシート本文。")).not.toBe(armOf([]));
  });

  it("--condition を明示したらそれを使う（bench の外を触った時に分ける口）", () => {
    expect(armOf(["--condition", "after-adapter-change"])).toBe("after-adapter-change");
    expect(() => parseArgs(["--condition", "a/b"])).toThrow("--condition は");
  });
});

describe("会話を止める形", () => {
  const text = "<response><action>肩に手を置いた。</action><dialogue>「来たよ」</dialogue></response>";

  it("画面に何も出せん応答で会話を続けん（読み込み側と同じ判定）", () => {
    // 空白だけを見とった間、`<response></response>` で会話を続けて、読み込み側が
    // afterBrokenContext として丸ごと捨てる**課金済みのターン**を作っとった
    expect(
      stopReasonFor({ error: null, finishReason: null, text: "<response></response>" }, 2000),
    ).toContain("本文が空");
    expect(
      stopReasonFor(
        { error: null, finishReason: null, text: "<response><action>  </action></response>" },
        2000,
      ),
    ).toContain("本文が空");
  });

  it("外側のタグが無いタグだけの本文でも止める（画面に何も出せん）", () => {
    // `hasReadableResponseContent` は `<response>` の無い応答を素テキスト扱いするので、
    // `<action></action>` を「中身あり」と答える。積んで続けたら課金だけ増える
    expect(
      stopReasonFor({ error: null, finishReason: null, text: "<action></action>" }, 2000),
    ).toContain("本文が空");
  });

  it("読める本文が返っとる間は続ける", () => {
    expect(stopReasonFor({ error: null, finishReason: null, text }, 2000)).toBeNull();
  });

  it("上限切れと経路失敗でも止める", () => {
    expect(stopReasonFor({ error: null, finishReason: "length", text }, 2000)).toContain("上限");
    expect(stopReasonFor({ error: "[API_ERROR:429]", finishReason: null, text }, 2000)).toContain(
      "429",
    );
  });
});

describe("summary の書き込み", () => {
  it("一時ファイル経由で置き換える（途中で落ちても前の版が残る）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bench-summary-"));
    const target = path.join(dir, "summary-session-x-1.json");
    writeFileSync(target, JSON.stringify({ arm: "old" }), "utf-8");
    writeJsonAtomic(target, { arm: "new" });
    expect(JSON.parse(readFileSync(target, "utf-8"))).toStrictEqual({ arm: "new" });
    // 一時ファイルを残したら掃除でけてへん
    expect(readdirSync(dir)).toStrictEqual(["summary-session-x-1.json"]);
  });

  it("ターンの .txt もその場で切り詰めん（書きかけを本物の応答として読まれる）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bench-turn-"));
    const target = path.join(dir, "sakura-01.txt");
    writeFileAtomic(target, "# character: sakura\n本文");
    expect(readFileSync(target, "utf-8")).toContain("本文");
    expect(readdirSync(dir)).toStrictEqual(["sakura-01.txt"]);

    const source = readFileSync(path.resolve(import.meta.dirname, "generate.ts"), "utf-8");
    // 書きかけの .txt が残ると、次の bench:score がそれを応答として読んで長さも
    // XML の不良も歪む（課金済みのリクエストの記録が静かに別物になる）
    expect(source).not.toMatch(/writeFileSync\(\s*\n?\s*path\.join\(\s*\n?\s*runDir/);
  });

  it("summary をその場で切り詰めん（壊れた JSON を残さん）", () => {
    // 途中で落ちた時に壊れた JSON が残ると、`parseRunSummary` の JSON.parse が投げて
    // **bench-run のコーパス全体が読めん**ようになる。振る舞いでは落ちる瞬間を作れんので、
    // 「rename 経由で置き換える」ことを本文で固定する
    const source = readFileSync(path.resolve(import.meta.dirname, "generate.ts"), "utf-8");
    expect(source).toContain("renameSync(tempPath, target)");
    expect(source).not.toMatch(/writeFileSync\(\s*summaryPath/);
  });
});

describe("200 の封筒を読む", () => {
  it("choices が無い 200 は経路の失敗として返す（撮り直しへ回る）", () => {
    // 空のモデル応答として記録すると、API のプロトコル異常を**モデルの空返信**として
    // 数えた上に、リトライも回らんまま課金だけ済む
    for (const payload of [{}, { choices: [] }, { choices: [{}] }, { choices: [{ message: {} }] }]) {
      const read = readCompletion(payload);
      expect(read.error).toMatch(/^\[INFRA_ERROR/);
      expect(read.text).toBe("");
    }
  });

  it("中身が空文字なのはモデルの返事（経路の失敗にせん）", () => {
    expect(readCompletion({ choices: [{ message: { content: "" } }] })).toStrictEqual({
      text: "",
      error: null,
      finishReason: null,
    });
  });

  it("finish_reason を落とさん（上限切れを非XMLに化けさせん）", () => {
    expect(
      readCompletion({ choices: [{ message: { content: "本文" }, finish_reason: "length" }] })
        .finishReason,
    ).toBe("length");
  });
});

describe("課金の見積り", () => {
  it("応答が長いほど入力も膨らむ（上限は上限として計算する）", () => {
    // 応答は履歴に載るので、次のターン以降の入力を丸ごと押し上げる。
    // median の応答を仮定したまま「上限」と書いたら、--max-tokens 32000 の条件で
    // 実際の請求が上限を上回る
    const script = [{ user: "こんばんは。" }, { user: "隣、ええ？" }, { user: "手ぇ、貸して。" }];
    const median = accumulatePromptTokens(script, "キャラシート", "さくら", 1_092);
    const worst = accumulatePromptTokens(script, "キャラシート", "さくら", 32_000);
    expect(worst).toBeGreaterThan(median);
    // 差は最低でも「1ターンぶんの応答の伸び」。履歴に何回載るかはアダプタ側の
    // 積み方次第なので、そこは固定せん
    expect(worst - median).toBeGreaterThanOrEqual(32_000 - 1_092);

    // 上振れの表示が**上限まで出した履歴**から出とることを固定する
    const source = readFileSync(path.resolve(import.meta.dirname, "generate.ts"), "utf-8");
    expect(source).toContain("promptTokensFor(options.maxTokens)");
    expect(source).toMatch(/estimateCostRange\(heavyPromptTokens/);
    // **「最悪ケース」とは書かん。**1トークンが複数文字へ展開されたら履歴はこれより長い
    expect(source).not.toContain("最悪ケース");
  });

  it("撮り直しぶんの上限も出す（1回きりの数字だけやと上振れを見落とす）", () => {
    const { once, ceiling } = estimateCostRange(1_000, 2_000, {
      promptPerToken: 0.000_001,
      completionPerToken: 0.000_002,
    });
    expect(once).toBeCloseTo(0.005, 6);
    expect(ceiling).toBeCloseTo(once * MAX_ATTEMPTS_PER_TURN, 6);
    expect(MAX_ATTEMPTS_PER_TURN).toBe(4);
  });
});
