// 失敗の出口の表（板 TalkError）の文言とボタンの組を、画面が使う組立てそのままで確かめる。
// S-1〜S-6 は部品の表、S-12 は「返事を止める」、S-15 はオフライン送信（ChatView 結合）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeChatSession } from "../lib/chat-session";
import { hasMessageAction, isWaitingPhase, markerText, type TurnPhase } from "../lib/turn-phase";

import { ChatView } from "./chat-view";
import {
  TurnFailureBox,
  TurnMarker,
  TurnMessageAction,
  TurnStopButton,
  failureActionsFor,
  failureCopy,
} from "./chat-turn-failure";

// chat-view が失敗の状態から組み立てるのと同じ並びで出す検査用の枠。
const FailureFixture = ({
  phase,
  retry,
  withdraw,
}: {
  phase: TurnPhase;
  retry: () => void;
  withdraw: () => void;
}) => {
  const marker = markerText(phase);
  const failure = failureCopy(phase);
  const actions = failureActionsFor(phase, retry, withdraw);
  return (
    <>
      {hasMessageAction(phase) && <TurnMessageAction onWithdraw={withdraw} />}
      {marker !== null && <TurnMarker text={marker} icon={phase !== "resending"} />}
      {failure !== null && <TurnFailureBox {...failure} actions={actions} />}
    </>
  );
};

describe("失敗の出口の表（S-1〜S-6）", () => {
  afterEach(cleanup);

  // 失敗の枠の中の出口ボタンだけ数える（発言の操作ボタンは文字を持たんので混ぜん）。
  const buttonNames = () =>
    Array.from(screen.getByRole("alert").querySelectorAll<HTMLButtonElement>("button")).map(
      (button) => button.textContent,
    );

  it("S-1 送れなかった時: 印つきの「まだ送れていません」と失敗の枠、出口は「もう一度」「入力に戻す」", () => {
    const retry = vi.fn();
    const withdraw = vi.fn();
    render(<FailureFixture phase="send_failed" retry={retry} withdraw={withdraw} />);

    const marker = screen.getByText("まだ送れていません");
    // 「まだ送れていません」だけ印（i マーク）つき。
    expect(marker.parentElement?.querySelector(".v2-turn-marker-icon")).not.toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("メッセージを送れませんでした。");
    expect(buttonNames()).toEqual(["もう一度", "入力に戻す"]);

    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "入力に戻す" }));
    expect(withdraw).toHaveBeenCalledOnce();
    // 部品 C: 発言の左の操作ボタン（「入力に戻す」と同じ動き）も出る。
    expect(screen.getByRole("button", { name: "この発言の操作（取り消す）" })).toBeInTheDocument();
  });

  it("S-2 送り直している時: 「送り直しています」の印だけ。失敗の枠は出さん", () => {
    render(<FailureFixture phase="resending" retry={vi.fn()} withdraw={vi.fn()} />);

    expect(screen.getByText("送り直しています")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 出口は部品 C（発言の操作）だけ。枠のボタンは無い。
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "この発言の操作（取り消す）" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "もう一度" })).not.toBeInTheDocument();
  });

  it("S-3 返事が届かなかった時: 「返事が届きませんでした。」出口は「もう一度」だけ", () => {
    render(<FailureFixture phase="no_reply" retry={vi.fn()} withdraw={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("返事が届きませんでした。");
    expect(buttonNames()).toEqual(["もう一度"]);
    // 「入力に戻す」も部品 C も出さん（送信は部屋に届いとる）。
    expect(screen.queryByText("まだ送れていません")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "この発言の操作（取り消す）" }),
    ).not.toBeInTheDocument();
  });

  it("S-4 返事が途中で止まった時: 「返事が途中で止まりました。」出口は「もう一度」だけ", () => {
    render(<FailureFixture phase="cut_off" retry={vi.fn()} withdraw={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("返事が途中で止まりました。");
    expect(buttonNames()).toEqual(["もう一度"]);
  });

  it("S-5 もう一度送れない時: 副の文つきの失敗の枠、出口は「入力に戻す」だけ", () => {
    render(<FailureFixture phase="rejected" retry={vi.fn()} withdraw={vi.fn()} />);

    expect(screen.getByText("まだ送れていません")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("メッセージを送れませんでした。");
    expect(alert).toHaveTextContent("このままでは送れません。");
    expect(alert).toHaveTextContent("入力に戻して、書き直してください。");
    // 「もう一度」は出さん（同じ文では確実に断られる）。
    expect(buttonNames()).toEqual(["入力に戻す"]);
    expect(screen.getByRole("button", { name: "この発言の操作（取り消す）" })).toBeInTheDocument();
  });

  it("S-6 オフラインの時: 「オフラインです。」＋副の文、出口は「もう一度」だけ", () => {
    render(<FailureFixture phase="offline" retry={vi.fn()} withdraw={vi.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("オフラインです。");
    expect(alert).toHaveTextContent("つながったら、もう一度送れます。");
    expect(buttonNames()).toEqual(["もう一度"]);
  });
});

describe("「返事を止める」の出し方（S-12）", () => {
  afterEach(cleanup);

  it("待ちの 4 状態では「返事を止める」が送信と入れ替わる", () => {
    const waiting = ["sending", "writing", "slow", "arriving"] as const;
    for (const phase of waiting) expect(isWaitingPhase(phase)).toBe(true);
    const still = [
      "idle",
      "send_failed",
      "resending",
      "no_reply",
      "cut_off",
      "rejected",
      "offline",
      "stopped",
    ] as const;
    for (const phase of still) expect(isWaitingPhase(phase)).toBe(false);
  });

  it("部品 D の名札は「返事を止める」、押し中は効かん", () => {
    const onStop = vi.fn();
    const { rerender } = render(<TurnStopButton disabled={false} onClick={onStop} />);
    const button = screen.getByRole("button", { name: "返事を止める" });
    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledOnce();

    rerender(<TurnStopButton disabled={true} onClick={onStop} />);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("オフライン送信（S-15）", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
    fireEvent(window, new Event(online ? "online" : "offline"));
  };

  it("オフラインで送信を押しても POST は出ず、文は入力欄に残り、つながると枠が消える", async () => {
    writeChatSession("a", { version: 1, conversationId: "conversation-a", pending: null });
    const fetchMock = vi.fn(async () => Response.json({ turn: 2, history: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatView characterId="a" characterName="案内役" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeEnabled());
    fetchMock.mockClear();

    setOnline(false);
    fireEvent.change(screen.getByRole("textbox", { name: "メッセージ" }), {
      target: { value: "圏外のひとこと" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    // POST は出さん。文は入力欄に残る。
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("圏外のひとこと");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("オフラインです。");
    expect(alert).toHaveTextContent("つながったら、もう一度送れます。");
    expect(screen.getAllByRole("button", { name: "もう一度" })).toHaveLength(1);
    // 部品 B の文だけ。見出しの「オフラインです」は出さん。
    expect(screen.queryByRole("heading", { name: "オフラインです" })).toBeNull();

    // オフラインのまま「もう一度」を押しても、やはり POST は出さん。
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("圏外のひとこと");
    expect(screen.getByRole("alert")).toHaveTextContent("オフラインです。");

    // つながったら枠は消える。自動では送らん（送信を押すまでは文を持って待つだけ）。
    setOnline(true);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toHaveValue("圏外のひとこと");
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
  });
});
