import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { useChatAnnouncement } from "./use-chat-announcement";

const userMessage: ChatMessage = { id: "u1", role: "user", content: "こんばんは" };

const assistant = (content: string, isStreaming: boolean): ChatMessage => ({
  id: "a1",
  role: "assistant",
  content,
  isStreaming,
});

const NO_IMAGE = new Set<string>();

describe("useChatAnnouncement", () => {
  it("履歴を読み込んだだけの初回描画では何も読み上げん", () => {
    const { result } = renderHook(() =>
      useChatAnnouncement(
        [userMessage, assistant("<dialogue>おかえり</dialogue>", false)],
        NO_IMAGE,
      ),
    );

    expect(result.current).toBe("");
  });

  it("本文が来る前は考え中を出し、ストリーミング中は文言を変えん", () => {
    const { result, rerender } = renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useChatAnnouncement(messages, NO_IMAGE),
      { initialProps: { messages: [userMessage, assistant("", true)] } },
    );

    expect(result.current).toBe("ことばを探している");

    // トークンが伸びるたびに読み上げ文字列が変わると、スクリーンリーダーが
    // 全文を読み直す。伸びても変わらんことがこのフックの核心。
    rerender({ messages: [userMessage, assistant("<dialogue>お", true)] });
    const midway = result.current;
    rerender({ messages: [userMessage, assistant("<dialogue>おかえ", true)] });
    expect(result.current).toBe(midway);
    rerender({ messages: [userMessage, assistant("<dialogue>おかえりなさ", true)] });
    expect(result.current).toBe(midway);
  });

  it("ストリーミングが終わった時にだけ本文をタグ抜きで読み上げる", () => {
    const { result, rerender } = renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useChatAnnouncement(messages, NO_IMAGE),
      { initialProps: { messages: [userMessage, assistant("", true)] } },
    );

    rerender({ messages: [userMessage, assistant("<dialogue>おかえり", true)] });
    expect(result.current).not.toContain("おかえり");

    rerender({ messages: [userMessage, assistant("<dialogue>おかえりなさい</dialogue>", false)] });
    expect(result.current).toBe("おかえりなさい");
  });

  it("画像生成の開始と到着を読み上げる", () => {
    const done = assistant("<dialogue>はい</dialogue>", false);
    const arrived: ChatMessage = { ...done, imageUrl: "images/abc.png" };
    const { result, rerender } = renderHook(
      ({ generating, message }: { generating: Set<string>; message: ChatMessage }) =>
        useChatAnnouncement([userMessage, message], generating),
      { initialProps: { generating: new Set(["a1"]), message: done } },
    );

    expect(result.current).toBe("画像を生成中");

    rerender({ generating: new Set<string>(), message: arrived });
    expect(result.current).toBe("画像が届きました");
  });

  // 生成が失敗しても runImageGenerationTask の finally が id を外すので、
  // 「生成中でなくなった」だけを到着とみなすと、失敗の度に届いたと嘘を言う。
  it("生成が失敗して画像が付かんかった時は到着と言わん", () => {
    const done = assistant("<dialogue>はい</dialogue>", false);
    const { result, rerender } = renderHook(
      ({ generating }: { generating: Set<string> }) =>
        useChatAnnouncement([userMessage, done], generating),
      { initialProps: { generating: new Set(["a1"]) } },
    );

    expect(result.current).toBe("画像を生成中");

    rerender({ generating: new Set<string>() });
    expect(result.current).toBe("画像を用意でけませんでした");
  });
  // 既に画像が付いたメッセージの再生成が失敗すると古い imageUrl が残る。
  // 「今 imageUrl があるか」だけで判断すると、それを新着と誤認して嘘を言う。
  it("画像付きメッセージの再生成が失敗したら到着と言わん", () => {
    const withImage: ChatMessage = {
      ...assistant("<dialogue>はい</dialogue>", false),
      imageUrl: "images/old.png",
    };
    const { result, rerender } = renderHook(
      ({ generating }: { generating: Set<string> }) =>
        useChatAnnouncement([userMessage, withImage], generating),
      { initialProps: { generating: new Set(["a1"]) } },
    );

    expect(result.current).toBe("画像を生成中");

    rerender({ generating: new Set<string>() });
    expect(result.current).toBe("画像を用意でけませんでした");
  });

  it("画像付きメッセージの再生成が成功したら到着を伝える", () => {
    const withImage: ChatMessage = {
      ...assistant("<dialogue>はい</dialogue>", false),
      imageUrl: "images/old.png",
    };
    const replaced: ChatMessage = { ...withImage, imageUrl: "images/new.png" };
    const { result, rerender } = renderHook(
      ({ generating, message }: { generating: Set<string>; message: ChatMessage }) =>
        useChatAnnouncement([userMessage, message], generating),
      { initialProps: { generating: new Set(["a1"]), message: withImage } },
    );

    expect(result.current).toBe("画像を生成中");

    rerender({ generating: new Set<string>(), message: replaced });
    expect(result.current).toBe("画像が届きました");
  });

  // 生成の待ち時間中にユーザーは次を送れる。対象が末尾から外れても取りこぼさん。
  it("生成中に次の発言が来ても、元のメッセージの完了を読み上げる", () => {
    const done: ChatMessage = { ...assistant("<dialogue>はい</dialogue>", false), id: "a1" };
    const arrived: ChatMessage = { ...done, imageUrl: "images/new.png" };
    const later: ChatMessage = { id: "u2", role: "user", content: "つづき" };

    const { result, rerender } = renderHook(
      ({ generating, messages }: { generating: Set<string>; messages: ChatMessage[] }) =>
        useChatAnnouncement(messages, generating),
      { initialProps: { generating: new Set(["a1"]), messages: [userMessage, done] } },
    );

    expect(result.current).toBe("画像を生成中");

    // ユーザーが次を送って、画像の対象が末尾やのうなる
    rerender({ generating: new Set(["a1"]), messages: [userMessage, done, later] });
    rerender({ generating: new Set<string>(), messages: [userMessage, arrived, later] });

    expect(result.current).toBe("画像が届きました");
  });
  // ユーザーが次を送った直後、新しい返信は本文が空のままストリーミングに入る。
  // その窓で画像側の開始・完了が返信側に踏み潰されると、消費だけされて
  // 二度と読み上げられん。生成待ちは必ずこの窓と重なる。
  it("次の返信が本文ゼロで流れとる間も、画像の開始と完了を読み上げる", () => {
    const done: ChatMessage = { ...assistant("<dialogue>はい</dialogue>", false), id: "a1" };
    const arrived: ChatMessage = { ...done, imageUrl: "images/new.png" };
    const streamingNext: ChatMessage = {
      id: "a2",
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    const { result, rerender } = renderHook(
      ({ generating, messages }: { generating: Set<string>; messages: ChatMessage[] }) =>
        useChatAnnouncement(messages, generating),
      { initialProps: { generating: NO_IMAGE, messages: [userMessage, done] } },
    );

    // 次の返信が本文ゼロで走り出す
    rerender({ generating: NO_IMAGE, messages: [userMessage, done, streamingNext] });
    expect(result.current).toBe("ことばを探している");

    // その最中に前の返信の画像生成が始まる
    rerender({ generating: new Set(["a1"]), messages: [userMessage, done, streamingNext] });
    expect(result.current).toBe("画像を生成中");

    rerender({ generating: NO_IMAGE, messages: [userMessage, arrived, streamingNext] });
    expect(result.current).toBe("画像が届きました");
  });

  // 会話を切り替えると messages ごと差し替わる。対象が見つからんだけで失敗と
  // 断じると、成功しとっても嘘を言う。
  it("会話を切り替えて対象が消えたら、失敗とは言わん", () => {
    const done: ChatMessage = { ...assistant("<dialogue>はい</dialogue>", false), id: "a1" };
    const otherConversation: ChatMessage[] = [{ id: "u9", role: "user", content: "べつの会話" }];

    const { result, rerender } = renderHook(
      ({ generating, messages }: { generating: Set<string>; messages: ChatMessage[] }) =>
        useChatAnnouncement(messages, generating),
      { initialProps: { generating: new Set(["a1"]), messages: [userMessage, done] } },
    );

    expect(result.current).toBe("画像を生成中");

    rerender({ generating: NO_IMAGE, messages: otherConversation });
    expect(result.current).not.toBe("画像を用意でけませんでした");
  });
});
