import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/store/chat-store";

import { buildImagePromptFromHistory, detectImageScenePhase } from "./chat-image-prompt";

const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({
  id,
  role,
  content,
});

describe("buildImagePromptFromHistory", () => {
  it("preserves latest situational context when the prompt must be trimmed", () => {
    const longOlderContext = "古い控室の会話 ".repeat(80);
    const messages: ChatMessage[] = [
      message("u1", "user", longOlderContext),
      message("a1", "assistant", longOlderContext),
      message("u2", "user", "まだ廊下で立ち話をしている"),
      message("a2", "assistant", "廊下の照明を見上げている"),
      message("u3", "user", "ベッドの上で膝をついて、赤い毛布を握っている"),
      message("a3", "assistant", "頬を赤らめて見上げ、ベッドの上で身体を寄せる"),
    ];

    const prompt = buildImagePromptFromHistory(messages, 320, 3);

    expect(prompt).toContain("[最新]");
    expect(prompt).toContain("ベッドの上で膝をついて");
    expect(prompt).toContain("身体を寄せる");
    expect(prompt.length).toBeLessThanOrEqual(320);
  });

  it("uses recent assistant context as fallback when only assistant turns are available", () => {
    const prompt = buildImagePromptFromHistory([
      message("a1", "assistant", "ソファで微笑みながら手を振る"),
    ]);

    expect(prompt).toContain("ソファで微笑みながら手を振る");
  });
});

describe("detectImageScenePhase", () => {
  it("uses the latest visible assistant scene for chat-image phase selection", () => {
    const messages: ChatMessage[] = [
      message("u1", "user", "そばにいて"),
      message("a1", "assistant", "キスを返して、シャツのボタンに指をかける"),
    ];

    expect(detectImageScenePhase(messages)).toBe("intimate");
  });

  it("keeps explicit image prompt context from falling back to conversation phase", () => {
    const messages: ChatMessage[] = [
      message("u1", "user", "もっと近くにいたい"),
      message("a1", "assistant", "ベッドの上で身体を寄せる"),
    ];

    expect(detectImageScenePhase(messages, "奥まで入れて、乱れた寝室のシーン")).toBe("erotic");
  });
});
