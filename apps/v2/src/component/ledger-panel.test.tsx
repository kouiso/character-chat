import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatMap, LedgerPanel, parseMapText } from "./ledger-panel";

const LEDGER = {
  phase: "intimate",
  location: "台所",
  time: "深夜",
  present: ["さくら", "あなた"],
  clothing: { さくら: "ニット" },
  position: "立ったまま",
  lastEvents: ["キスをした"],
  items: { スマホ: "彼のポケット" },
};

const ledgerResponse = (ledger: unknown) =>
  Response.json({ ledger }, { status: 200 });

describe("台帳パネル", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("「台帳」ボタンで開き、GET で読んだ値を表示する", async () => {
    const fetchMock = vi.fn(async () => ledgerResponse(LEDGER));
    vi.stubGlobal("fetch", fetchMock);
    render(<LedgerPanel characterId="char" getConversationId={() => "conv"} />);

    fireEvent.click(screen.getByRole("button", { name: "台帳" }));

    expect(await screen.findByText("台所")).toBeInTheDocument();
    expect(screen.getByText("深夜")).toBeInTheDocument();
    expect(screen.getByText("スマホ:彼のポケット")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat/char/ledger?conversationId=conv"),
      expect.anything(),
    );
  });

  it("台帳が無い会話では案内を出す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ledgerResponse(null)));
    render(<LedgerPanel characterId="char" getConversationId={() => "conv"} />);

    fireEvent.click(screen.getByRole("button", { name: "台帳" }));

    expect(await screen.findByText(/まだ台帳がありません/)).toBeInTheDocument();
  });

  it("直して保存すると PATCH で最新台帳を送る", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ turn: 3 }, { status: 200 });
      return ledgerResponse(LEDGER);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LedgerPanel characterId="char" getConversationId={() => "conv"} />);

    fireEvent.click(screen.getByRole("button", { name: "台帳" }));
    fireEvent.click(await screen.findByRole("button", { name: "直す" }));

    const locationInput = screen.getByLabelText("場所");
    fireEvent.change(locationInput, { target: { value: "屋上" } });
    fireEvent.change(screen.getByLabelText(/持ち物/), {
      target: { value: "スマホ:彼のポケット\n鍵:さくらの鞄" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body));
      expect(body.conversationId).toBe("conv");
      expect(body.ledger.location).toBe("屋上");
      expect(body.ledger.items).toEqual({ スマホ: "彼のポケット", 鍵: "さくらの鞄" });
      expect(body.ledger.phase).toBe("intimate");
    });
    expect(await screen.findByText(/ターン3/)).toBeInTheDocument();
  });

  it("conversationId が無ければ会話未開始として扱う（fetch しない）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LedgerPanel characterId="char" getConversationId={() => null} />);

    fireEvent.click(screen.getByRole("button", { name: "台帳" }));

    expect(await screen.findByText(/まだ台帳がありません/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("行形式の出入力", () => {
  it("formatMap と parseMapText が往復する", () => {
    const map = { さくら: "ニット", あなた: "半裸" };
    expect(parseMapText(formatMap(map))).toEqual(map);
  });

  it("コロンの無い行・空キーは捨てる", () => {
    expect(parseMapText("さくら:ニット\n壊れた行\n:値無し\nあなた:半裸")).toEqual({
      さくら: "ニット",
      あなた: "半裸",
    });
  });
});
