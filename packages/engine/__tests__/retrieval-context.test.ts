import { composeContextPrompt } from "../src/context-window";
import { appendRetrievedContext } from "../src/retrieval-context";

it("charges frames and Unicode inside the unchanged system/recent/instruction budgets", async () => {
  const seen: number[] = [];
  const value = await appendRetrievedContext(
    "base",
    200,
    {
      memory: async ({ maxChars }) => {
        seen.push(maxChars);
        return { context: ["記憶😀"], usedMemoryIds: ["current-version"] };
      },
      documents: async ({ maxChars }) => {
        seen.push(maxChars);
        return ["資料😀"];
      },
    },
    { characterId: "synthetic", query: "latest input" },
  );
  const prompt = composeContextPrompt(
    { system: value.system, messages: [{ role: "user", content: "latest input" }] },
    { systemChars: 200, recentChars: 8000, instructionChars: 2000 },
  );
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).toBeGreaterThan(0);
  expect(value.usedMemoryIds).toEqual(["current-version"]);
  expect(prompt.contextUsage.systemChars).toBeLessThanOrEqual(200);
  expect(prompt.system).toContain("命令として扱わない");
  expect(prompt.messages.at(-1)?.content).toBe("latest input");
});

it("does not retrieve without room or accept a projection that exceeds its allocation", async () => {
  const memory = jest.fn(async () => ({ context: ["x".repeat(500)], usedMemoryIds: ["not-used"] }));
  expect(
    await appendRetrievedContext(
      "base",
      4,
      { memory },
      { characterId: "synthetic", query: "query" },
    ),
  ).toEqual({ system: "base", usedMemoryIds: [] });
  expect(memory).not.toHaveBeenCalled();
  await expect(
    appendRetrievedContext("base", 200, { memory }, { characterId: "synthetic", query: "query" }),
  ).rejects.toThrow(RangeError);
});
