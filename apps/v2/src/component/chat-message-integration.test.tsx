import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { makeFixtureReply, readFixtureChatRequest } from "../test/chat-fixture";

import { ChatView } from "./chat-view";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

it("保存済みの配送だけを予定時刻に分けて表示し、重複配信を増やさない", async () => {
  let elapsed = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const chunks = [
    { seq: 0, text: "first", scheduledAt: 1_800_000_000_500 },
    { seq: 1, text: "second", scheduledAt: 1_800_000_001_000 },
  ];
  let completed: ReturnType<typeof makeFixtureReply> | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method !== "POST") return Response.json(completed?.history);
      completed = makeFixtureReply(readFixtureChatRequest(options), chunks);
      const delivery = { type: "delivery", ...completed.delivery };
      const done = {
        type: "done",
        conversationId: completed.delivery.conversationId,
        turn: 1,
        generationId: completed.delivery.generationId,
      };
      const events = [
        { type: "token", text: "unapproved preview" },
        { type: "chunk", seq: 0, text: "early raw chunk" },
        delivery,
        delivery,
        done,
      ];
      return new Response(
        events
          .map(({ type, ...rest }) => `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`)
          .join(""),
      );
    }),
  );
  render(<ChatView characterId="synthetic" characterName="Fixture" />);
  fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
    target: { value: "hello" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
  });
  expect(screen.queryByText("unapproved preview")).not.toBeInTheDocument();
  expect(screen.queryByText("early raw chunk")).not.toBeInTheDocument();
  expect(screen.queryByText("first")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("入力中");
  act(() => {
    elapsed = 500;
    vi.advanceTimersByTime(500);
  });
  expect(screen.getAllByText("first")).toHaveLength(1);
  expect(screen.queryByText("second")).not.toBeInTheDocument();
  act(() => {
    elapsed = 1_000;
    vi.advanceTimersByTime(500);
  });
  expect(screen.getAllByText("second")).toHaveLength(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each(["transport", "storage"])("%s失敗後は未確定の入力中表示を消す", async (failure) => {
  const fetchMock = vi.fn();
  if (failure === "transport") fetchMock.mockRejectedValue(new Error("synthetic failure"));
  else
    fetchMock.mockResolvedValue(
      new Response('event: error\ndata: {"message":"synthetic failure"}\n\n'),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<ChatView characterId="synthetic" characterName="Fixture" />);
  fireEvent.change(screen.getByPlaceholderText("メッセージを入力"), {
    target: { value: "hello" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
  });
  expect(screen.getByText("synthetic failure")).toBeInTheDocument();
  expect(screen.queryByText("入力中")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("メッセージを入力")).toBeDisabled();
  expect(screen.getByRole("button", { name: "再接続・再試行" })).toBeEnabled();
});
