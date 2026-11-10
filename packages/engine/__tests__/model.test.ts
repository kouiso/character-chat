import { createModelChain, createOpenRouterModel, OPENROUTER_PROVIDER_POLICY } from "../src/model";

// RIT-100 の「壊しにいく確かめ」: DeepSeek 本家の除外・data_collection=deny が
// 外れた時に検査が止まること。provider フィールドはリクエストの provider プリファレンスへ
// そのまま出る（@langchain/openrouter の invocationParams 参照）。
// BaseChatModel の型には provider/baseURL が無いので modelNameOf と同じく Reflect で読む。
const fieldOf = (model: object, key: string): unknown => Reflect.get(model, key);

const providerOf = (candidate: { model: unknown }) =>
  fieldOf(candidate.model as object, "provider") as Record<string, unknown> | undefined;

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

// RIT-104: チェーンの順序・env 上書き・全候補への provider 制約の試験。
describe("createModelChain（RIT-104）", () => {
  test("既定は deepseek-v4.1-flash-1017 → dolphin → Venice 固定 flash の順", () => {
    const chain = createModelChain({ OPENROUTER_API_KEY: "test-key" });
    expect(chain.map((c) => c.name)).toEqual([
      "deepseek/deepseek-v4.1-flash-1017",
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      "deepseek/deepseek-v4.1-flash",
    ]);
  });

  test("全候補に DeepSeek 実行先除外と学習利用の拒否が載る", () => {
    for (const candidate of createModelChain({ OPENROUTER_API_KEY: "test-key" })) {
      const provider = providerOf(candidate);
      expect(provider?.ignore).toContain("DeepSeek");
      expect(provider?.data_collection).toBe("deny");
    }
  });

  test("逃げ道 2 だけ実行先を Venice へ固定する", () => {
    const chain = createModelChain({ OPENROUTER_API_KEY: "test-key" });
    expect(providerOf(chain[0])?.only).toBeUndefined();
    expect(providerOf(chain[1])?.only).toBeUndefined();
    expect(providerOf(chain[2])?.only).toEqual(["Venice"]);
  });

  test("V2_MODEL は単モデル指定として 1 本だけの列になる", () => {
    const chain = createModelChain({ OPENROUTER_API_KEY: "test-key", V2_MODEL: "foo/bar" });
    expect(chain.map((c) => c.name)).toEqual(["foo/bar"]);
  });

  test("V2_MODEL_CHAIN の JSON で候補列を上書きできる", () => {
    const chain = createModelChain({
      OPENROUTER_API_KEY: "test-key",
      V2_MODEL_CHAIN: JSON.stringify([
        { model: "a/one" },
        { model: "b/two", providerOnly: ["Venice"] },
      ]),
    });
    expect(chain.map((c) => c.name)).toEqual(["a/one", "b/two"]);
    expect(providerOf(chain[1])?.only).toEqual(["Venice"]);
  });

  test("V2_MODEL_CHAIN が壊れとる・空列の時は黙って止まらず既定へ倒す", () => {
    for (const broken of ["not json", "[]", "{}", JSON.stringify([{ wrong: 1 }])]) {
      const chain = createModelChain({ OPENROUTER_API_KEY: "test-key", V2_MODEL_CHAIN: broken });
      expect(chain).toHaveLength(3);
    }
  });
});

// RIT-199: セーフモードはアダルト応答をモデル自身が拒否する側のチェーンへ切り替える。
describe("createModelChain セーフモード（RIT-199）", () => {
  test("safeMode=true はセーフ既定チェーン（主流モデル）になる", () => {
    const chain = createModelChain({ OPENROUTER_API_KEY: "test-key" }, { safeMode: true });
    expect(chain.map((c) => c.name)).toEqual(["openai/gpt-4.1-mini", "google/gemini-2.5-flash"]);
  });

  test("safeMode=false・未指定は従来チェーンのまま", () => {
    for (const options of [{}, { safeMode: false }]) {
      const chain = createModelChain({ OPENROUTER_API_KEY: "test-key" }, options);
      expect(chain.map((c) => c.name)).toEqual([
        "deepseek/deepseek-v4.1-flash-1017",
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
        "deepseek/deepseek-v4.1-flash",
      ]);
    }
  });

  test("V2_SAFE_MODEL_CHAIN の JSON でセーフ側チェーンを上書きできる", () => {
    const chain = createModelChain(
      {
        OPENROUTER_API_KEY: "test-key",
        V2_SAFE_MODEL_CHAIN: JSON.stringify([{ model: "safe/one" }]),
      },
      { safeMode: true },
    );
    expect(chain.map((c) => c.name)).toEqual(["safe/one"]);
  });

  test("セーフ側チェーンが壊れとる時はセーフ既定へ倒す", () => {
    for (const broken of ["not json", "[]", "{}"]) {
      const chain = createModelChain(
        { OPENROUTER_API_KEY: "test-key", V2_SAFE_MODEL_CHAIN: broken },
        { safeMode: true },
      );
      expect(chain.map((c) => c.name)).toEqual(["openai/gpt-4.1-mini", "google/gemini-2.5-flash"]);
    }
  });

  test("V2_MODEL ピン留めはセーフ切替でも上書きせん", () => {
    const chain = createModelChain(
      { OPENROUTER_API_KEY: "test-key", V2_MODEL: "pinned/model" },
      { safeMode: true },
    );
    expect(chain.map((c) => c.name)).toEqual(["pinned/model"]);
  });
});

describe("createModelChain チャットモード（RIT-205）", () => {
  test("quality は NSFW 耐性実測済み筆頭＋逃げ道、light は軽い単モデルになる", () => {
    const quality = createModelChain({ OPENROUTER_API_KEY: "test-key" }, { chatMode: "quality" });
    expect(quality.map((c) => c.name)).toEqual([
      "deepseek/deepseek-v4.1-flash-1017",
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
      "deepseek/deepseek-v4.1-flash",
    ]);
    const light = createModelChain({ OPENROUTER_API_KEY: "test-key" }, { chatMode: "light" });
    expect(light.map((c) => c.name)).toEqual([
      "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    ]);
  });

  test("standard・未指定は従来チェーンのまま", () => {
    for (const options of [{}, { chatMode: "standard" as const }]) {
      const chain = createModelChain({ OPENROUTER_API_KEY: "test-key" }, options);
      expect(chain.map((c) => c.name)).toEqual([
        "deepseek/deepseek-v4.1-flash-1017",
        "cognitivecomputations/dolphin-mistral-24b-venice-edition",
        "deepseek/deepseek-v4.1-flash",
      ]);
    }
  });

  test("セーフはモードより先に効く（quality でもセーフチェーン）", () => {
    const chain = createModelChain(
      { OPENROUTER_API_KEY: "test-key" },
      { safeMode: true, chatMode: "quality" },
    );
    expect(chain.map((c) => c.name)).toEqual(["openai/gpt-4.1-mini", "google/gemini-2.5-flash"]);
  });

  test("V2_QUALITY_MODEL_CHAIN / V2_LIGHT_MODEL_CHAIN で上書きできる", () => {
    const quality = createModelChain(
      {
        OPENROUTER_API_KEY: "test-key",
        V2_QUALITY_MODEL_CHAIN: JSON.stringify([{ model: "heavy/one" }]),
      },
      { chatMode: "quality" },
    );
    expect(quality.map((c) => c.name)).toEqual(["heavy/one"]);
    const light = createModelChain(
      {
        OPENROUTER_API_KEY: "test-key",
        V2_LIGHT_MODEL_CHAIN: JSON.stringify([{ model: "tiny/one" }]),
      },
      { chatMode: "light" },
    );
    expect(light.map((c) => c.name)).toEqual(["tiny/one"]);
  });

  test("V2_MODEL ピン留めはモード切替でも上書きせん", () => {
    const chain = createModelChain(
      { OPENROUTER_API_KEY: "test-key", V2_MODEL: "pinned/model" },
      { chatMode: "light" },
    );
    expect(chain.map((c) => c.name)).toEqual(["pinned/model"]);
  });
});
