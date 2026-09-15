import { describe, expect, it } from "vitest";

import { extractScenePrefixFromPrompt } from "../[[route]]";

describe("extractScenePrefixFromPrompt", () => {
  it("extracts scene tags from a raw prompt", () => {
    expect(extractScenePrefixFromPrompt("sakura, lying on bed, bedroom")).toContain("on_bed");
    expect(extractScenePrefixFromPrompt("sakura, on sofa")).toContain("on_sofa");
  });

  it("prefers the latest user segment over assistant hallucination", () => {
    const prompt =
      "[最新] ユーザー: ソファに腰掛けさせて、膝の間に入る\n[最新] キャラ: シーツを濡らしていくのが分かる";
    const result = extractScenePrefixFromPrompt(prompt);
    expect(result).toContain("on_sofa");
    expect(result).not.toContain("on_bed");
  });

  it("falls back to the most recent user segment that mentions a location", () => {
    const prompt =
      "[1ターン前] ユーザー: バーで座ってる\n[1ターン前] キャラ: 寝室に移動した\n[最新] ユーザー: もっと近くに来て\n[最新] キャラ: ベッドに倒れ込んだ";
    const result = extractScenePrefixFromPrompt(prompt);
    expect(result).toContain("bar");
    expect(result).not.toContain("on_bed");
    expect(result).not.toContain("bedroom");
  });

  it("falls back to an earlier sofa mention when the latest user segment has no location", () => {
    const prompt =
      "[1ターン前] ユーザー: ソファに座って飲もう\n[1ターン前] キャラ: ふふ、いいよ\n[最新] ユーザー: もっと近くに来て\n[最新] キャラ: 気持ちいい…";
    const result = extractScenePrefixFromPrompt(prompt);
    expect(result).toContain("on_sofa");
    expect(result).not.toContain("on_bed");
    expect(result).not.toContain("bedroom");
  });

  it("does not inject outdoors for erotic/climax/afterglow without explicit outdoor play intent", () => {
    const prompt = "[最新] ユーザー: 路地裏で拾われた話を思い出す\n[最新] キャラ: もっと激しくして";
    expect(extractScenePrefixFromPrompt(prompt, "erotic")).not.toContain("outdoors");
    expect(extractScenePrefixFromPrompt(prompt, "erotic")).not.toContain("alley");
    expect(extractScenePrefixFromPrompt(prompt, "climax")).not.toContain("outdoors");
    expect(extractScenePrefixFromPrompt(prompt, "afterglow")).not.toContain("outdoors");
  });

  it("keeps outdoors for conversation/intimate even without explicit outdoor play intent", () => {
    const prompt = "[最新] ユーザー: 路地裏で待ち合わせ\n[最新] キャラ: 了解";
    expect(extractScenePrefixFromPrompt(prompt, "conversation")).toContain("alley");
    expect(extractScenePrefixFromPrompt(prompt, "conversation")).toContain("outdoors");
    expect(extractScenePrefixFromPrompt(prompt, "intimate")).toContain("alley");
    expect(extractScenePrefixFromPrompt(prompt, "intimate")).toContain("outdoors");
  });

  it("allows outdoors for erotic/climax/afterglow when the user explicitly requests outdoor play", () => {
    const prompt = "[最新] ユーザー: 外で野外プレイしよう\n[最新] キャラ: ドキドキする";
    expect(extractScenePrefixFromPrompt(prompt, "erotic")).toContain("outdoors");
    expect(extractScenePrefixFromPrompt(prompt, "climax")).toContain("outdoors");
    expect(extractScenePrefixFromPrompt(prompt, "afterglow")).toContain("outdoors");
  });

  it("defaults to indoors for erotic/climax/afterglow when no location is mentioned", () => {
    const prompt = "[最新] ユーザー: もっと激しくして\n[最新] キャラ: いいよ";
    expect(extractScenePrefixFromPrompt(prompt, "erotic")).toContain("indoors");
    expect(extractScenePrefixFromPrompt(prompt, "climax")).toContain("indoors");
    expect(extractScenePrefixFromPrompt(prompt, "afterglow")).toContain("indoors");
  });

  it("uses the latest user segment only for explicit phases and ignores stale outdoor mentions", () => {
    const prompt =
      "[1ターン前] ユーザー: 公園で待ってる\n[1ターン前] キャラ: いいね\n[最新] ユーザー: ベッドで激しく\n[最新] キャラ: もっと";
    const result = extractScenePrefixFromPrompt(prompt, "erotic");
    expect(result).toContain("indoor");
    expect(result).toContain("bedroom");
    expect(result).not.toContain("outdoors");
    expect(result).not.toContain("park");
  });
});
