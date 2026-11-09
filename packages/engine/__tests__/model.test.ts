import { createOpenRouterModel, OPENROUTER_PROVIDER_POLICY } from "../src/model";

// RIT-100 の「壊しにいく確かめ」: DeepSeek 本家の除外・data_collection=deny が
// 外れた時に検査が止まること。provider フィールドはリクエストの provider プリファレンスへ
// そのまま出る（@langchain/openrouter の invocationParams 参照）。
// BaseChatModel の型には provider/baseURL が無いので modelNameOf と同じく Reflect で読む。
const fieldOf = (model: object, key: string): unknown => Reflect.get(model, key);

describe("createOpenRouterModel の provider ポリシー", () => {
  test("DeepSeek 本家を除外し data_collection は deny", () => {
    const model = createOpenRouterModel({ OPENROUTER_API_KEY: "test-key" });
    expect(fieldOf(model, "provider")).toMatchObject({
      ignore: ["DeepSeek"],
      data_collection: "deny",
    });
  });

  test("ポリシー定数は契約どおりの形", () => {
    // 除外を消したり形を変えた時にここで落ちる。
    expect(OPENROUTER_PROVIDER_POLICY).toEqual({
      ignore: ["DeepSeek"],
      data_collection: "deny",
    });
  });

  test("AI Gateway の baseURL を env で差せる", () => {
    const gateway = "https://gateway.ai.cloudflare.com/v1/acct/gw/openrouter";
    const model = createOpenRouterModel({
      OPENROUTER_API_KEY: "test-key",
      V2_OPENROUTER_BASE_URL: gateway,
    });
    expect(fieldOf(model, "baseURL")).toBe(gateway);
  });

  test("baseURL 未設定は OpenRouter 既定のまま", () => {
    const model = createOpenRouterModel({ OPENROUTER_API_KEY: "test-key" });
    expect(fieldOf(model, "baseURL")).toBe("https://openrouter.ai/api/v1");
  });
});
