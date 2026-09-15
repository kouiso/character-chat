import { describe, expect, it } from "vitest";

import { containsNegationPhrase, PHASE_GUARDRAILS } from "../lib/image-phase-guardrails";
import {
  buildVisualAnchorPrompt,
  dedupePromptTags,
  hasUsableIdentityAnchor,
  resolveVisualAnchorWeight,
  stripFloatingCumTags,
  VISUAL_ANCHOR_WEIGHT,
} from "../lib/image-prompt-anchors";

const PHASES = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

// チャット内画像の prompt 組み立てが char-approval-process.md の「盛るな」原則を
// 破っていないかを機械的に固定する。過去の審査記録(D1 image_review)で最も多い不合格理由が
// 「タッチが変わる/光が強すぎる/画質ティア不一致」で、いずれも盛り過ぎの症状。
describe("chat image prompt hygiene", () => {
  describe("同一概念の重複送信（表記ゆれ）", () => {
    // S_TIER_NEGATIVE_INJECTION は underscore 表記、末尾の固定 negative は space 表記で
    // 同じ概念を書いており、旧 dedupe は別タグとして両方通していた。CLIP ではトークンの
    // 繰り返し = 実質的な重み増しになるため、解剖系 negative だけが無断で強調されていた。
    it("underscore と space の表記ゆれを同一タグへ畳む", () => {
      expect(dedupePromptTags("extra_fingers, extra fingers")).toBe("extra_fingers");
      expect(dedupePromptTags("poorly_drawn_hands, poorly drawn hands")).toBe("poorly_drawn_hands");
      expect(dedupePromptTags("bad_hands, bad hands")).toBe("bad_hands");
    });

    it("実際の negative 連結で解剖タグが 1 回だけになる", () => {
      const sTier = "extra_fingers, fused_hands, malformed_hands, mutated_hands, extra_hands";
      const tail = "extra fingers, fused_hands, malformed_hands, mutated_hands, extra hands";
      const deduped = dedupePromptTags(`${sTier}, ${tail}`);
      expect(deduped.split(",").length).toBe(5);
    });

    it("重み付きタグと素タグも同一概念として畳む", () => {
      expect(dedupePromptTags("(extra_hands:1.5), extra hands")).toBe("(extra_hands:1.5)");
    });

    it("別概念は畳まない", () => {
      const deduped = dedupePromptTags("extra_fingers, fewer_fingers, missing_fingers");
      expect(deduped.split(",").length).toBe(3);
    });
  });

  describe("stripFloatingCumTags の回帰", () => {
    // tagKey の正規化を変えたので、判定セット側の引き方が壊れていないか固定する。
    it("顔・宙に飛ぶ汎用タグは除去する", () => {
      expect(stripFloatingCumTags("blush, cum_on_face, smile")).toBe("blush, smile");
      expect(stripFloatingCumTags("blush, bukkake")).toBe("blush");
    });

    it("中出し系の局所タグは残す", () => {
      const kept = stripFloatingCumTags("creampie, cum_in_pussy, cum_dripping_from_pussy");
      expect(kept).toBe("creampie, cum_in_pussy, cum_dripping_from_pussy");
    });
  });

  describe("positive prompt への否定表現の混入", () => {
    // 拡散モデルに否定演算子は無い。"no nudity" と書くと nudity が positive 側へ入り、
    // 同じ属性を positive と negative の両方から押す形になる。
    it("どの phase の positiveHint にも否定語が無い", () => {
      for (const phase of PHASES) {
        expect(
          containsNegationPhrase(PHASE_GUARDRAILS[phase].positiveHint),
          `${phase} の positiveHint に否定語が含まれている: ${PHASE_GUARDRAILS[phase].positiveHint}`,
        ).toBe(false);
      }
    });

    it("positiveHint が negativeExtra と同じトークンを押し返していない", () => {
      for (const phase of PHASES) {
        const guardrail = PHASE_GUARDRAILS[phase];
        const negativeTokens = new Set(
          guardrail.negativeExtra
            .split(",")
            .map((tag) =>
              tag
                .trim()
                .toLowerCase()
                .replace(/[\s_]+/g, " "),
            )
            .filter(Boolean),
        );
        const positiveWords = guardrail.positiveHint
          .split(/[\s,]+/)
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        for (const word of positiveWords) {
          expect(
            negativeTokens.has(word),
            `${phase}: "${word}" が positive と negative の両方に出ている`,
          ).toBe(false);
        }
      }
    });
  });

  describe("visual anchor の重み", () => {
    it("どの phase でも正典の VISUAL_ANCHOR_WEIGHT を超えない", () => {
      for (const phase of PHASES) {
        expect(resolveVisualAnchorWeight(phase)).toBeLessThanOrEqual(VISUAL_ANCHOR_WEIGHT);
      }
    });

    it("旧実装の intimate 以降 1.9 は正典超えだった（回帰防止の基準値）", () => {
      const legacyWeight = (phase: string) => (phase === "conversation" ? 1.5 : 1.9);
      expect(legacyWeight("erotic")).toBeGreaterThan(VISUAL_ANCHOR_WEIGHT);
      expect(resolveVisualAnchorWeight("erotic")).toBeLessThanOrEqual(VISUAL_ANCHOR_WEIGHT);
    });

    it("conversation の据え置き値は正典より弱いまま", () => {
      expect(resolveVisualAnchorWeight("conversation")).toBeLessThan(VISUAL_ANCHOR_WEIGHT);
    });
  });

  describe("身元アンカー欠落の検出", () => {
    it("空・空白・カンマだけのアンカーを使用不能と判定する", () => {
      expect(hasUsableIdentityAnchor("")).toBe(false);
      expect(hasUsableIdentityAnchor("   ")).toBe(false);
      expect(hasUsableIdentityAnchor(", ,")).toBe(false);
    });

    it("タグが 1 つでもあれば使用可能と判定する", () => {
      expect(hasUsableIdentityAnchor("brown hair")).toBe(true);
      expect(hasUsableIdentityAnchor(", blue eyes,")).toBe(true);
    });
  });

  describe("重み付きグループの保全", () => {
    // dedupePromptTags がカンマで素朴に割ると、重み付きグループが途中で千切れる。
    // 末尾の断片が既出タグと同一概念になると、その断片ごと落ちて閉じ括弧と重みが消える。
    it("重み付きグループを分解せず 1 タグとして扱う", () => {
      const anchor = buildVisualAnchorPrompt("brown hair, blue eyes, anime, best_quality", 1.6);
      const deduped = dedupePromptTags(["best quality", anchor].join(", "));
      expect(deduped).toBe("best quality, (brown hair:1.6), (blue eyes, anime:1.6)");
    });

    it("括弧の開閉が釣り合ったまま返る", () => {
      const anchor = buildVisualAnchorPrompt("brown hair, blue eyes, anime, best_quality", 1.6);
      const deduped = dedupePromptTags(["best quality", anchor].join(", "));
      const open = [...deduped].filter((c) => c === "(").length;
      const close = [...deduped].filter((c) => c === ")").length;
      expect(open).toBe(close);
    });

    it("グループの外側にある重複は従来どおり畳む", () => {
      expect(dedupePromptTags("(a, b:1.5), extra_fingers, extra fingers")).toBe(
        "(a, b:1.5), extra_fingers",
      );
    });

    it("nested weighted group の内部も外側のタグと重複させない", () => {
      expect(dedupePromptTags("a, (b, (a, c:1.2):1.5), c")).toBe("a, (b, (c:1.2):1.5)");
    });

    // stripFloatingCumTags も独自にカンマ分割していたので、同じ壊れ方をしていた。
    it("禁止タグの除去でも重み付きグループを壊さない", () => {
      const stripped = stripFloatingCumTags("(blue eyes, cum on face:1.6), smile");
      expect(stripped).toBe("(blue eyes:1.6), smile");
      const open = [...stripped].filter((c) => c === "(").length;
      const close = [...stripped].filter((c) => c === ")").length;
      expect(open).toBe(close);
    });

    it("グループの中身が全部禁止タグならグループごと消す", () => {
      expect(stripFloatingCumTags("(cum on face:1.6), smile")).toBe("smile");
    });

    it("グループ外の禁止タグは従来どおり消す", () => {
      expect(stripFloatingCumTags("(blue eyes:1.6), cum_on_face, smile")).toBe(
        "(blue eyes:1.6), smile",
      );
    });
  });
});
