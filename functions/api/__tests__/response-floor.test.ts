import { describe, expect, it } from "vitest";

import { RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH } from "../../../src/lib/quality-guard";
import {
  RESPONSE_CEILING_HARD_MAX,
  RESPONSE_FLOOR_HARD_MAX,
  RESPONSE_FLOOR_HARD_MIN,
  resolveResponseFloor,
} from "../lib/route-context";

// 長さは「20分前に設定画面で決めた固定値」ではなく、場面と相手のターンから決まる。
// 現行は erotic/climax で short と medium が文字単位で同一のリクエストになっており
// (getEffectiveLongResponseMinChars の Math.max(phaseFloor, preset.minChars))、
// UI の段を動かしても出力が変わらん。ここはその否定をテストで固定する。

const PHASES = ["conversation", "intimate", "afterglow", "erotic", "climax"] as const;
const LENGTHS = ["short", "medium", "long", "very_long"] as const;
const ENERGIES = [5, 40, 200] as const;

// 上限に張り付いた区間では差が出ようがないので、単調性は「下がらない」＋
// 「上限未満なら厳密に増える」の二段で見る。
const expectRises = (lower: number, higher: number, label: string) => {
  expect(higher, label).toBeGreaterThanOrEqual(lower);
  if (higher < RESPONSE_FLOOR_HARD_MAX) {
    expect(higher, `${label}（上限未満なので厳密に増えるべき）`).toBeGreaterThan(lower);
  }
};

const floorOf = (
  phase: (typeof PHASES)[number],
  responseLength: (typeof LENGTHS)[number],
  lastUserTurnChars: number,
) => resolveResponseFloor({ phase, responseLength, lastUserTurnChars }).minChars;

describe("resolveResponseFloor", () => {
  it("同じ場面・同じ熱量で、好みを上げるとフロアが下がらない（上限に当たるまでは必ず上がる）", () => {
    for (const phase of PHASES) {
      for (const chars of ENERGIES) {
        LENGTHS.slice(1).forEach((length, i) =>
          expectRises(
            floorOf(phase, LENGTHS[i], chars),
            floorOf(phase, length, chars),
            `${phase}/${length}@${chars}`,
          ),
        );
      }
    }
  });

  it("好み・熱量を固定して場面を上げるとフロアが単調に上がる", () => {
    for (const length of LENGTHS) {
      for (const chars of ENERGIES) {
        const floors = PHASES.map(
          (phase) =>
            resolveResponseFloor({ phase, responseLength: length, lastUserTurnChars: chars })
              .minChars,
        );
        for (let i = 1; i < floors.length; i++) {
          expect(floors[i], `${PHASES[i]}/${length}@${chars}`).toBeGreaterThanOrEqual(
            floors[i - 1],
          );
        }
      }
    }
  });

  it("相手のターンが長いほどフロアが上がる（Match the user's energy の実装）", () => {
    for (const phase of PHASES) {
      for (const length of LENGTHS) {
        const quiet = resolveResponseFloor({ phase, responseLength: length, lastUserTurnChars: 5 });
        const rich = resolveResponseFloor({
          phase,
          responseLength: length,
          lastUserTurnChars: 200,
        });
        expect(rich.minChars, `${phase}/${length}`).toBeGreaterThanOrEqual(quiet.minChars);
        // フロアは自分の段の上限にも頭を押さえられる（切り詰めまでの余白を残すため）。
        // その天井へ両方が張り付いた組み合わせは、増えんのが正しい。
        const ceilingBoundFloor = Math.round(RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH[length] * 0.8);
        if (rich.minChars < Math.min(RESPONSE_FLOOR_HARD_MAX, ceilingBoundFloor)) {
          expect(
            rich.minChars,
            `${phase}/${length} は上限未満なら厳密に増えるべき`,
          ).toBeGreaterThan(quiet.minChars);
        }
      }
    }
  });

  it("erotic の short と medium が同じ値にならない（局長報告のバグの直接の否定）", () => {
    for (const phase of ["erotic", "climax"] as const) {
      const short = resolveResponseFloor({ phase, responseLength: "short", lastUserTurnChars: 40 });
      const medium = resolveResponseFloor({
        phase,
        responseLength: "medium",
        lastUserTurnChars: 40,
      });
      expect(short.minChars).not.toBe(medium.minChars);
    }
  });

  it("フロア・上限・max_tokens が常に整合する", () => {
    for (const phase of PHASES) {
      for (const length of LENGTHS) {
        for (const chars of ENERGIES) {
          const r = resolveResponseFloor({
            phase,
            responseLength: length,
            lastUserTurnChars: chars,
          });
          expect(r.minChars).toBeGreaterThanOrEqual(RESPONSE_FLOOR_HARD_MIN);
          expect(r.minChars).toBeLessThanOrEqual(RESPONSE_FLOOR_HARD_MAX);
          expect(r.maxChars).toBeGreaterThan(r.minChars);
          expect(r.maxChars).toBeLessThanOrEqual(RESPONSE_CEILING_HARD_MAX);
          expect(r.maxTokens).toBeGreaterThan(0);
        }
      }
    }
  });

  it("エロの「短め」でも薄い返しにならない（会話の「たっぷり」より下回らない）", () => {
    const eroticShort = resolveResponseFloor({
      phase: "erotic",
      responseLength: "short",
      lastUserTurnChars: 5,
    });
    const conversationVeryLong = resolveResponseFloor({
      phase: "conversation",
      responseLength: "very_long",
      lastUserTurnChars: 5,
    });
    expect(eroticShort.minChars).toBeGreaterThanOrEqual(conversationVeryLong.minChars);
  });
});
