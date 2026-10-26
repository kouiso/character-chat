import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ChatImage } from "./chat-image";

afterEach(cleanup);
it("画像が失敗しても本文を遮らず再読み込みできる", () => {
  render(<ChatImage src="/api/media/example" />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByRole("status")).toHaveTextContent("画像を読み込めませんでした。");
  fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
  expect(screen.getByRole("img")).toHaveAttribute("src", "/api/media/example?retry=1");
});
