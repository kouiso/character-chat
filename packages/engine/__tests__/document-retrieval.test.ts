import {
  DocumentSettingsSchema,
  createDocumentProjection,
  retrieveDocumentContext,
  type DocumentChunk,
  type DocumentSettings,
  type DocumentSource,
} from "../src/document-retrieval";

const settings = (): DocumentSettings => ({
  budgetChars: 100,
  documents: [
    { id: "on", characterId: "fixture", enabled: true, budgetChars: 30 },
    { id: "off", characterId: "fixture", enabled: false, budgetChars: 30 },
    { id: "foreign", characterId: "other", enabled: true, budgetChars: 30 },
    { id: "zero", characterId: "fixture", enabled: true, budgetChars: 0 },
  ],
});

const chunk = (documentId: string, text: string, id = "part-1"): DocumentChunk => ({
  id,
  documentId,
  characterId: "fixture",
  text,
});

const fixtureSource = (metadata = settings(), chunks: DocumentChunk[] = []) => {
  const search = jest.fn<
    ReturnType<DocumentSource["search"]>,
    Parameters<DocumentSource["search"]>
  >(async () => chunks);
  const source: DocumentSource = { loadSettings: async () => metadata, search };
  return { source, search };
};

const input = { characterId: "fixture", query: "合成の設定は？" };

describe("document retrieval metadata and budgets", () => {
  test.each(["off", "removed", "individual-zero", "total-zero"])(
    "検索中の %s を最新設定で除外する",
    async (mode) => {
      const metadata = settings();
      const source: DocumentSource = {
        loadSettings: async () => metadata,
        search: async () => {
          if (mode === "off") metadata.documents[0].enabled = false;
          if (mode === "removed") metadata.documents = metadata.documents.slice(1);
          if (mode === "individual-zero") metadata.documents[0].budgetChars = 0;
          if (mode === "total-zero") metadata.budgetChars = 0;
          return [chunk("on", "STALE_DOCUMENT_SENTINEL")];
        },
      };
      expect(await retrieveDocumentContext(source, input)).toEqual([]);
    },
  );

  test("検索後の個別上限とroot残枠をラベル込みコードポイントで守る", async () => {
    const metadata = settings();
    const source: DocumentSource = {
      loadSettings: async () => metadata,
      search: async () => {
        metadata.documents[0].budgetChars = 3;
        return [chunk("on", "🌟a🌈bc")];
      },
    };
    const project = createDocumentProjection(source);
    expect(await project({ ...input, maxChars: Array.from("【設定資料】\n").length + 2 })).toEqual([
      "【設定資料】\n🌟a",
    ]);
    expect(await project({ ...input, maxChars: 100 })).toEqual(["【設定資料】\n🌟a🌈"]);
  });

  test("root残枠がラベル以下なら検索せず資料を付加しない", async () => {
    const { source, search } = fixtureSource();
    expect(await createDocumentProjection(source)({ ...input, maxChars: 0 })).toEqual([]);
    expect(await createDocumentProjection(source)({ ...input, maxChars: 7 })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  test.each([-1, 0.5, NaN, Infinity])("不正なroot残枠 %s を拒否する", async (maxChars) => {
    const { source, search } = fixtureSource();
    await expect(createDocumentProjection(source)({ ...input, maxChars })).rejects.toThrow(
      "資料の利用字数枠",
    );
    expect(search).not.toHaveBeenCalled();
  });

  test("検索前に ON の資料 ID だけ渡し、検索側の OFF・別キャラ・未知 ID の混入も落とす", async () => {
    const { source, search } = fixtureSource(settings(), [
      chunk("off", "OFF_SENTINEL"),
      chunk("foreign", "FOREIGN_SENTINEL"),
      chunk("missing", "UNKNOWN_SENTINEL"),
      chunk("zero", "ZERO_SENTINEL"),
      { ...chunk("on", "OTHER_CHARACTER"), characterId: "other" },
      chunk("on", "架空の街の時計は青い"),
    ]);
    expect(await retrieveDocumentContext(source, input)).toEqual([
      "【設定資料】\n架空の街の時計は青い",
    ]);
    expect(search).toHaveBeenCalledWith({ ...input, documentIds: ["on"] });
  });

  test.each(["all-off", "zero-total", "zero-document", "empty", "prefix-only"])(
    "%s でも検索を呼ばず空の資料枠で続く",
    async (mode) => {
      const metadata = settings();
      if (mode === "all-off") metadata.documents.forEach((document) => (document.enabled = false));
      if (mode === "zero-total") metadata.budgetChars = 0;
      if (mode === "zero-document")
        metadata.documents.forEach((document) => (document.budgetChars = 0));
      if (mode === "empty") metadata.documents = [];
      if (mode === "prefix-only") metadata.budgetChars = Array.from("【設定資料】\n").length;
      const { source, search } = fixtureSource(metadata);
      expect(await retrieveDocumentContext(source, input)).toEqual([]);
      expect(search).not.toHaveBeenCalled();
    },
  );

  test("資料別の上限は複数 chunk の合計で制限し、重複を除外する", async () => {
    const metadata = settings();
    metadata.documents[0].budgetChars = 5;
    metadata.documents[1].enabled = true;
    const { source } = fixtureSource(metadata, [
      chunk("on", "abc"),
      chunk("on", "abc"),
      chunk("on", "def", "part-2"),
      chunk("on", "NEVER", "part-3"),
      chunk("off", "second"),
    ]);
    expect(await retrieveDocumentContext(source, input)).toEqual(["【設定資料】\nabc\nde\nsecond"]);
  });

  test("全資料の上限は枠名と区切りも含み、Unicode の途中で切らん", async () => {
    const metadata = settings();
    metadata.budgetChars = Array.from("【設定資料】\n").length + 4;
    const { source } = fixtureSource(metadata, [chunk("on", "🌟a"), chunk("on", "🌈b", "part-2")]);
    const context = await retrieveDocumentContext(source, input);
    expect(context).toEqual(["【設定資料】\n🌟a\n🌈"]);
    expect(Array.from(context[0])).toHaveLength(metadata.budgetChars);
  });

  test("空白だけの結果と検索結果なしでは枠名も追加せん", async () => {
    const { source } = fixtureSource(settings(), [chunk("on", " \n ")]);
    expect(await retrieveDocumentContext(source, input)).toEqual([]);
    expect(await retrieveDocumentContext(fixtureSource().source, input)).toEqual([]);
    expect(await retrieveDocumentContext(undefined, input)).toEqual([]);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100_001])(
    "不正な予算 %s を検索前に拒否する",
    async (budgetChars) => {
      const metadata = settings();
      metadata.budgetChars = budgetChars;
      const { source, search } = fixtureSource(metadata);
      await expect(retrieveDocumentContext(source, input)).rejects.toThrow();
      expect(search).not.toHaveBeenCalled();
      expect(
        DocumentSettingsSchema.safeParse({
          ...settings(),
          documents: [{ ...settings().documents[0], budgetChars }],
        }).success,
      ).toBe(false);
    },
  );

  test("重複 ID や enabled の欠落を拒否し、暗黙の ON にせん", () => {
    const metadata = settings();
    metadata.documents.push(metadata.documents[0]);
    expect(DocumentSettingsSchema.safeParse(metadata).success).toBe(false);
    expect(
      DocumentSettingsSchema.safeParse({
        budgetChars: 100,
        documents: [{ id: "missing-enabled", characterId: "fixture", budgetChars: 30 }],
      }).success,
    ).toBe(false);
  });
});
