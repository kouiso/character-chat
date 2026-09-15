// bench の床の写しが本番とズレたら落ちる。
//
// 置き場所が functions/ 側なのは型の都合。route-context.ts は Cloudflare の型（R2Bucket 等）を
// 使うので、script/ の tsconfig からは型検査でけへん。script/ 側へ workers-types の参照を
// 足すと、今度は script/e2e の DOM 型が Cloudflare の Response に上書きされて壊れる。
import { describe, expect, it } from "vitest";

import { SCENE_PHASES } from "../../../script/bench/corpus";
import {
  benchFloorFor,
  resolveBenchResponseFloor,
  type ResponseLength,
} from "../../../script/bench/response-floor";
import { resolveResponseFloor } from "../lib/route-context";

const LENGTHS: ResponseLength[] = ["short", "medium", "long", "very_long"];

// 本番の式を写しとるので、写しが古くなったらここで落ちる。
// route-context は D1 と Hono を連れてくるので、import はこのテストの中だけに閉じる。
describe("床の式が本番と一致する", () => {
  it("phase × responseLength × 相手のターン長の全組で一致する", () => {
    for (const phase of SCENE_PHASES) {
      for (const responseLength of LENGTHS) {
        for (const lastUserTurnChars of [0, 20, 21, 80, 81, 400]) {
          expect(resolveBenchResponseFloor({ phase, responseLength, lastUserTurnChars })).toBe(
            resolveResponseFloor({ phase, responseLength, lastUserTurnChars }).minChars,
          );
        }
      }
    }
  });

  it("記録に無い responseLength はハーネスの既定 medium で測る", () => {
    expect(benchFloorFor("erotic", null)).toBe(benchFloorFor("erotic", "medium"));
  });

  it("知らん設定名は判定せん（medium の床で測らん）", () => {
    // `verylong` のような打ち間違いを medium で測ると、群のラベルは別の条件のまま
    // 不足率だけ medium の契約で出る。**記録が無いのと、記録が読めんのは別物**
    expect(benchFloorFor("erotic", "verylong")).toBeNull();
    expect(benchFloorFor("erotic", "bench:max_tokens=2000")).toBeNull();
    // `in` は継承したプロパティも true にする。床の式へ入って NaN になり、
    // 判定できてへんのに「不足やない」として分母に残っとった
    expect(benchFloorFor("erotic", "constructor")).toBeNull();
    expect(benchFloorFor("erotic", "toString")).toBeNull();
  });

  it("長さの指示を送っとらん run には床が無い（null）", () => {
    // 送ってへん契約と照らして「不足」を数えたらあかん。
    // bench:generate は分量の指示を出さんのに、summary の文字列が medium へ倒れて
    // 生成した10ターン全部が不足になっとった
    expect(benchFloorFor("erotic", null, null, false)).toBeNull();
    expect(benchFloorFor("erotic", "very_long", 200, false)).toBeNull();
    expect(benchFloorFor("erotic", null, null, true)).not.toBeNull();
  });

  it("very_long の床は medium より高い（設定を無視した固定床に戻したら落ちる）", () => {
    expect(benchFloorFor("erotic", "very_long")).toBeGreaterThan(
      benchFloorFor("erotic", "medium") ?? 0,
    );
    expect(benchFloorFor("erotic", "very_long")).toBe(1312);
  });
});
