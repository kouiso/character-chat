import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateCharacter, type GeneratedCharacter } from "@/lib/character-generator";
import type * as CharacterGeneratorModule from "@/lib/character-generator";

import { OuCreateFlowEntry } from "./ou-create-flow-entry";

const createCharacterEntry = vi.fn();

vi.mock("@/hook/use-character-query", () => ({
  useCharacterQuery: () => ({ createCharacterEntry }),
}));

vi.mock("@/lib/character-generator", async (importOriginal) => {
  const original = await importOriginal<typeof CharacterGeneratorModule>();
  return { ...original, generateCharacter: vi.fn() };
});

const generated: GeneratedCharacter = {
  name: "あおい",
  characterGender: "female",
  targetUserGender: "any",
  relationshipToUser: "旅の仲間",
  personality: "穏やか",
  scenario: "図書館で出会う",
  greeting: "こんにちは",
  tags: ["読書"],
  eroticProfile: "",
};

describe("作成画面からの保存", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.mocked(generateCharacter).mockReset();
    createCharacterEntry.mockReset();
  });

  // 閉じる操作は「作成画面を開く前の画面へ戻る」移動を伴う。会話への移動の後に閉じると、
  // その移動を巻き戻して元の画面へ戻ってしまう。閉じてから会話へ移る順を固定する。
  it("保存できたら、作成画面を閉じてから作ったキャラの会話へ移り、その後は閉じ直さない", async () => {
    const calls: string[] = [];
    createCharacterEntry.mockResolvedValueOnce({ id: "char-1" });
    vi.mocked(generateCharacter).mockResolvedValueOnce(generated);
    render(
      <OuCreateFlowEntry
        open
        onOpenChange={(open) => calls.push(`open:${String(open)}`)}
        onCreated={(id) => calls.push(`created:${id}`)}
      />,
    );
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    await screen.findByText("できあがり");
    fireEvent.click(screen.getByRole("button", { name: /この子に/ }));
    await waitFor(() => expect(calls).toContain("created:char-1"));
    expect(calls).toEqual(["open:false", "created:char-1"]);
  });

  it("保存に失敗したら閉じも移りもせず、内容を残す", async () => {
    const calls: string[] = [];
    createCharacterEntry.mockRejectedValueOnce(new Error("offline"));
    vi.mocked(generateCharacter).mockResolvedValueOnce(generated);
    render(
      <OuCreateFlowEntry
        open
        onOpenChange={(open) => calls.push(`open:${String(open)}`)}
        onCreated={(id) => calls.push(`created:${id}`)}
      />,
    );
    fireEvent.click(screen.getByText("おまかせでつくる"));
    fireEvent.click(screen.getByRole("button", { name: "もう作って" }));
    await screen.findByText("できあがり");
    fireEvent.click(screen.getByRole("button", { name: /この子に/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(calls).toEqual([]);
    expect(screen.getByText("できあがり")).toBeInTheDocument();
  });
});
