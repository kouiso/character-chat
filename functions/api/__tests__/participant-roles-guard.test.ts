import { describe, expect, it } from "vitest";

import { buildUserNameAndRoleGuard } from "../lib/route-context";

describe("buildUserNameAndRoleGuard", () => {
  it("male user + female character produces the insertive-user / receptive-character guard", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "コウスケ",
      userGender: "male",
      characterGender: "female",
    });
    expect(guard).toContain("ユーザーの名前は「コウスケ」と呼ぶ");
    expect(guard).toContain("キャラクターが受ける側の表現にする");
    expect(guard).toContain("コウスケ、私の中に出して");
  });

  it("female user + male character produces the receptive-user / insertive-character guard", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "ハナ",
      userGender: "female",
      characterGender: "male",
    });
    expect(guard).toContain("ユーザーの名前は「ハナ」と呼ぶ");
    expect(guard).toContain("ユーザーが受け側、キャラクターが挿入側");
    expect(guard).toContain("ハナ、あんたの中に出してやる");
  });

  it("same-sex explicit genders produce a neutral guard", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "アキ",
      userGender: "female",
      characterGender: "female",
    });
    expect(guard).toContain("ユーザーの名前は「アキ」と呼ぶ");
    expect(guard).toContain("性別から機械的に決めず");
    expect(guard).not.toContain("ユーザーが挿入側");
    expect(guard).not.toContain("ユーザーが受け側");
  });

  it("'other' gender produces a neutral guard", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "カイト",
      userGender: "other",
      characterGender: "female",
    });
    expect(guard).toContain("性別から機械的に決めず");
    expect(guard).not.toContain("ユーザーが挿入側");
    expect(guard).not.toContain("ユーザーが受け側");
  });

  it("missing genders fall back to the default guard for backward compatibility", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "コウスケ",
    });
    expect(guard).toContain("キャラクターが受ける側の表現にする");
    expect(guard).toContain("コウスケ、私の中に出して");
  });

  it("no userName uses second-person pronouns and keeps role guard", () => {
    const guard = buildUserNameAndRoleGuard({
      userGender: "male",
      characterGender: "female",
    });
    expect(guard).toContain("ユーザーの名前は未登録");
    expect(guard).toContain("あんた、私の中に出して");
  });

  it("explicit userRole/characterRole override gender-derived phrasing", () => {
    const guard = buildUserNameAndRoleGuard({
      userName: "コウスケ",
      userGender: "male",
      characterGender: "female",
      userRole: "receptive",
      characterRole: "insertive",
    });
    expect(guard).toContain("ユーザーが受け側、キャラクターが挿入側");
    expect(guard).toContain("コウスケ、あんたの中に出してやる");
  });
});
