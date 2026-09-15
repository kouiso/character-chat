import { describe, expect, it } from "vitest";

import {
  describeImageGenerationError,
  describeImagePersistError,
  IMAGE_IDENTITY_MISSING_CODE,
} from "./image-generation-error";

describe("describeImageGenerationError", () => {
  // generateImage は !response.ok の時に response.text() をそのまま error に詰めるので、
  // 実際に届くのは 422 の JSON 本文そのもの。その形で判別できることを固定する。
  it("422 の生ボディから身元アンカー欠落を判別する", () => {
    const rawBody = JSON.stringify({ error: IMAGE_IDENTITY_MISSING_CODE });
    const message = describeImageGenerationError(rawBody);
    expect(message).toContain("見た目");
    expect(message).not.toBe(describeImageGenerationError("boom"));
  });

  it("原因不明の失敗は汎用文言へ落とす", () => {
    expect(describeImageGenerationError("Internal Server Error")).toBe(
      describeImageGenerationError(""),
    );
  });

  // ポーリングは getImageTaskResult が throw して失敗を伝えるため、catch には
  // 文字列でなく Error が来る。String 化しそこねると "[object Object]" が toast に出る。
  it("Error で渡された失敗もユーザー向け文言へ変換する", () => {
    const message = describeImageGenerationError(new Error("task result fetch failed: 500"));
    expect(message).toBe(describeImageGenerationError("boom"));
    expect(message).not.toContain("[object");
    expect(message).not.toContain("Error");
  });

  it("Error に身元コードが載っていれば原因まで出す", () => {
    const message = describeImageGenerationError(new Error(IMAGE_IDENTITY_MISSING_CODE));
    expect(message).toContain("見た目");
  });

  // 画像は表示済みで保存だけ失敗した状態。生成失敗と同じ文言を出すと、成功した画像を
  // 見ながら再試行を促され、枠を二重に使う。
  it("保存失敗は生成失敗と別の文言にし、再試行を促さない", () => {
    const persist = describeImagePersistError();
    expect(persist).not.toBe(describeImageGenerationError("boom"));
    expect(persist).toContain("保存");
    expect(persist).not.toContain("もう一度");
    expect(persist).not.toContain("時間をおいて");
  });

  // 429 / レート制限時は「混雑してるから待ってね」とユーザーに伝える。
  it("429 または rate_limit エラーをレート制限メッセージに変換する", () => {
    expect(describeImageGenerationError("429 Too Many Requests")).toContain("混雑");
    expect(
      describeImageGenerationError(JSON.stringify({ error: "rate_limited: rate_limit_exceeded" })),
    ).toContain("混雑");
    expect(
      describeImageGenerationError(
        JSON.stringify({ error: "upstream service error", upstream: { status: 429 } }),
      ),
    ).toContain("混雑");
  });

  // 文言そのものが空だと toast が無言で開くだけになる。
  it("どの入力でもユーザーに出せる文言を返す", () => {
    for (const raw of ["", "boom", IMAGE_IDENTITY_MISSING_CODE]) {
      expect(describeImageGenerationError(raw).length).toBeGreaterThan(10);
    }
  });
});
