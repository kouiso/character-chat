import { createOpenRouterModel, OpenRouterKeyMissingError } from "../src/model";
import { StrictOpenRouterChat } from "../src/openrouter-transport";
import { OpenRouterPolicyError, validateProviderPolicy } from "../src/provider-policy";

import type { OpenRouterRoute } from "../src/provider-policy";

jest.mock("../src/openrouter-transport", () => ({
  StrictOpenRouterChat: jest.fn(),
}));

const actual = jest.requireActual<{ StrictOpenRouterChat: typeof StrictOpenRouterChat }>(
  "../src/openrouter-transport",
);
const constructor = jest.mocked(StrictOpenRouterChat);
const env = { OPENROUTER_API_KEY: "synthetic-test-key" };
const denied = { ignore: ["DeepSeek"], data_collection: "deny" };

beforeEach(() => {
  constructor.mockClear();
  constructor.mockImplementation((fields) => new actual.StrictOpenRouterChat(fields));
});

test.each<{
  route: OpenRouterRoute;
  model: string;
  provider: typeof denied & { only?: string[]; allow_fallbacks?: boolean };
}>([
  {
    route: "primary",
    model: "deepseek/deepseek-v4.1-flash-1017",
    provider: denied,
  },
  {
    route: "fallback-1",
    model: "deepseek/deepseek-v4.1-flash",
    provider: { ...denied, only: ["Venice"], allow_fallbacks: false },
  },
  {
    route: "fallback-2",
    model: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    provider: denied,
  },
])(
  "$route sends its policy to both the constructor and SDK request",
  ({ route, model, provider }) => {
    const configured = createOpenRouterModel(env, route);
    expect(constructor).toHaveBeenCalledWith(
      expect.objectContaining({ model, provider, maxRetries: 0 }),
    );
    expect(configured.invocationParams({})).toEqual(expect.objectContaining({ model, provider }));
    expect(configured.baseURL).toBe("https://openrouter.ai/api/v1");
  },
);

test("the existing one-argument builder uses the specified primary model", () => {
  expect(createOpenRouterModel(env).model).toBe("deepseek/deepseek-v4.1-flash-1017");
});

test.each(["openai/gpt-5-mini", "openai/o3"])(
  "%s retains its reasoning settings and provider policy",
  (model) => {
    const configured = createOpenRouterModel({ ...env, V2_MODEL: model });
    expect(configured.invocationParams({ maxTokens: 300 })).toEqual(
      expect.objectContaining({
        model,
        max_tokens: 300,
        provider: denied,
        reasoning: { effort: "minimal" },
      }),
    );
  },
);

test("a non-reasoning model override retains provider restrictions", () => {
  const configured = createOpenRouterModel({ ...env, V2_MODEL: "synthetic/test-model" });
  const params = configured.invocationParams({});
  expect(params.model).toBe("synthetic/test-model");
  expect(params.provider).toEqual(denied);
  expect(params).not.toHaveProperty("reasoning");
});

test("external provider JSON and a gateway base URL reach the SDK", () => {
  const provider = { ...denied, only: ["Venice"], order: ["Venice"], require_parameters: true };
  const configured = createOpenRouterModel({
    ...env,
    V2_MODEL_PROVIDER: JSON.stringify(provider),
    V2_OPENROUTER_BASE_URL: "https://gateway.example.test/v1/account/gateway/openrouter/",
  });
  expect(configured.invocationParams({}).provider).toEqual(provider);
  expect(configured.baseURL).toBe("https://gateway.example.test/v1/account/gateway/openrouter");
});

test.each<OpenRouterRoute>(["fallback-1", "fallback-2"])(
  "%s does not inherit primary model/provider overrides",
  (route) => {
    const configured = createOpenRouterModel(
      {
        ...env,
        V2_MODEL: "synthetic/primary-model",
        V2_MODEL_PROVIDER: JSON.stringify({ ...denied, only: ["SyntheticProvider"] }),
      },
      route,
    );
    expect(configured.model).not.toBe("synthetic/primary-model");
    expect(configured.provider?.only).toEqual(route === "fallback-1" ? ["Venice"] : undefined);
    expect(configured.provider?.ignore).toEqual(["DeepSeek"]);
    expect(configured.provider?.data_collection).toBe("deny");
  },
);

test.each([
  { data_collection: "deny" },
  { ignore: [], data_collection: "deny" },
  { ignore: ["DeepSeek/Turbo"], data_collection: "deny" },
  { ignore: ["DeepSeek"], data_collection: "allow" },
  { ignore: ["DeepSeek"] },
  { ...denied, only: ["deepseek"] },
  { ...denied, order: ["DeepSeek/Turbo"] },
  { ...denied, only: [" DeepSeek (Turbo) "] },
  { ...denied, only: [] },
  { ...denied, only: [""] },
  { ...denied, unsupported: true },
  null,
  [],
])("unsafe or incomplete provider policy fails before model construction: %j", (policy) => {
  expect(() => validateProviderPolicy(policy)).toThrow(OpenRouterPolicyError);
  expect(() =>
    createOpenRouterModel({ ...env, V2_MODEL_PROVIDER: JSON.stringify(policy) }),
  ).toThrow(OpenRouterPolicyError);
  expect(constructor).not.toHaveBeenCalled();
});

test.each(["", "{", "synthetic-sensitive-value"])(
  "invalid provider JSON is redacted",
  (serialized) => {
    expect(() => createOpenRouterModel({ ...env, V2_MODEL_PROVIDER: serialized })).toThrow(
      OpenRouterPolicyError,
    );
    try {
      createOpenRouterModel({ ...env, V2_MODEL_PROVIDER: serialized });
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-sensitive-value");
    }
    expect(constructor).not.toHaveBeenCalled();
  },
);

test.each([
  "",
  "not-a-url",
  "file:///synthetic",
  "https://synthetic-user:synthetic-password@gateway.example.test/v1",
  "https://gateway.example.test/v1?token=synthetic-sensitive-value",
  "https://gateway.example.test/v1#synthetic-sensitive-value",
])("invalid or credential-bearing base URL fails without exposing its value", (baseURL) => {
  expect(() => createOpenRouterModel({ ...env, V2_OPENROUTER_BASE_URL: baseURL })).toThrow(
    OpenRouterPolicyError,
  );
  try {
    createOpenRouterModel({ ...env, V2_OPENROUTER_BASE_URL: baseURL });
  } catch (error) {
    expect(String(error)).not.toContain("synthetic-");
  }
  expect(constructor).not.toHaveBeenCalled();
});

test.each([undefined, "", "   "])(
  "missing or blank API keys fail before construction",
  (apiKey) => {
    expect(() => createOpenRouterModel({ OPENROUTER_API_KEY: apiKey })).toThrow(
      OpenRouterKeyMissingError,
    );
    expect(constructor).not.toHaveBeenCalled();
  },
);

test.each(["", "   "])("blank model overrides fail before construction", (model) => {
  expect(() => createOpenRouterModel({ ...env, V2_MODEL: model })).toThrow(OpenRouterPolicyError);
  expect(constructor).not.toHaveBeenCalled();
});
