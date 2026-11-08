import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProactiveToggle } from "./proactive-toggle";

const settingsResponse = (enabled: boolean) =>
  Promise.resolve(new Response(JSON.stringify({ settings: { enabled } }), { status: 200 }));

describe("話しかけの入切", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => settingsResponse(false)),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("読み込んだ設定がOFFなら未チェック、ONにしたら保存される", async () => {
    render(<ProactiveToggle characterId="char-1" />);
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/proactive/characters/char-1/settings",
      expect.anything(),
    );

    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    fireEvent.click(box);
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/proactive/characters/char-1/settings",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }),
      ),
    );
    await waitFor(() => expect(box).toBeChecked());
  });

  it("保存に失敗したら表示を元に戻す", async () => {
    render(<ProactiveToggle characterId="char-1" />);
    const box = await screen.findByRole("checkbox");
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 500 }));
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
