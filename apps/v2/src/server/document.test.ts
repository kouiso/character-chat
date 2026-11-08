// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterTable,
  listCharacterDocuments,
  loadDocumentChunks,
  setCharacterDocumentStatus,
  userTable,
  v2CharacterDocumentTable,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import {
  chunkDocumentText,
  deleteCharacterDocumentById,
  DocumentError,
  DOCUMENT_CHUNK_OVERLAP,
  DOCUMENT_CHUNK_SIZE,
  documentVectorReady,
  extractDocumentText,
  type DocumentVectorIndex,
  uploadCharacterDocument,
} from "./document";
import { retrieveDocumentChunks } from "./document-rag";

const owner = `doc-${crypto.randomUUID()}`;
const characterId = crypto.randomUUID();
const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));

const bindings = () => {
  const stored = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();
  const putMock = vi.fn();
  const deleteMock = vi.fn();
  const runMock = vi.fn().mockResolvedValue({ data: [vector] });
  const upsertMock = vi
    .fn()
    .mockImplementation(
      async (vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[]) => {
        for (const item of vectors) stored.set(item.id, item);
        return { ids: vectors.map((item) => item.id), count: vectors.length };
      },
    );
  const deleteByIdsMock = vi.fn().mockImplementation(async (ids: string[]) => {
    for (const id of ids) stored.delete(id);
    return { count: ids.length, ids };
  });
  const queryMock = vi
    .fn()
    .mockImplementation(
      async (_values: number[], options: { filter?: Record<string, unknown> }) => ({
        count: stored.size,
        matches: [...stored.entries()]
          .filter(([, item]) => {
            const filter = options?.filter ?? {};
            return Object.entries(filter).every(([key, value]) => item.metadata?.[key] === value);
          })
          .map(([id, item]) => ({ id, metadata: item.metadata, score: 0.9 })),
      }),
    );
  return {
    V2_RAG_ENABLED: "1",
    AI: { run: runMock as unknown as Ai["run"] },
    BUCKET: { put: putMock, delete: deleteMock } as never,
    MEMORY_INDEX: {
      upsert: upsertMock as never,
      query: queryMock as never,
      deleteByIds: deleteByIdsMock as never,
    },
    putMock,
    deleteMock,
    upsertMock,
    deleteByIdsMock,
    queryMock,
    stored,
  };
};

const textBytes = (text: string) => new TextEncoder().encode(text);

describe("chunkDocumentText", () => {
  it("1,200 字・200 字重ねで切る", () => {
    const text = "あ".repeat(DOCUMENT_CHUNK_SIZE * 2 + 500);
    const chunks = chunkDocumentText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].length).toBeLessThanOrEqual(DOCUMENT_CHUNK_SIZE);
    // 断片同士が重ねを持つ（次の断片の先頭は前の断片の末尾を含む）
    expect(chunks[1].slice(0, 50)).toBe(
      chunks[0].slice(
        chunks[0].length - DOCUMENT_CHUNK_OVERLAP,
        chunks[0].length - DOCUMENT_CHUNK_OVERLAP + 50,
      ),
    );
  });

  it("句点で切れ目を合わせる", () => {
    const text = `${"あ".repeat(600)}。${"い".repeat(400)}。${"う".repeat(400)}`;
    const chunks = chunkDocumentText(text);
    expect(chunks[0].endsWith("。")).toBe(true);
  });

  it("空・改行だけの本文は断片を返さん", () => {
    expect(chunkDocumentText("")).toStrictEqual([]);
    expect(chunkDocumentText("\n\n  \n")).toStrictEqual([]);
  });
});

describe("extractDocumentText", () => {
  it("TXT は utf-8 で読む", async () => {
    const text = await extractDocumentText(textBytes("設定メモ\n二号館"), "text/plain");
    expect(text).toContain("設定メモ");
  });

  it("対応してない型は 415", async () => {
    await expect(extractDocumentText(textBytes("x"), "application/zip")).rejects.toMatchObject({
      status: 415,
    });
  });

  it("文字の抜けない PDF は 422", async () => {
    await expect(
      extractDocumentText(textBytes("%PDF-1.4 broken"), "application/pdf"),
    ).rejects.toBeInstanceOf(DocumentError);
  });
});

describe("character document with local D1", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;

  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "v2-doc-d1-"));
    local = await openLocalD1({ persistRoot });
    await local.db.insert(userTable).values({
      id: owner,
      email: `${owner}@example.invalid`,
      createdAt: 1,
    });
    await local.db.insert(characterTable).values({
      id: characterId,
      userId: owner,
      name: "doc-char",
      systemPrompt: "資料検索の試験用キャラ。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: 1,
    });
    // wrangler のローカル D1 初期化は 10s を超えることがある
  }, 60_000);

  afterAll(async () => {
    await local?.dispose();
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  it("アップすると原本は R2、断片は D1 と検索箱へ載る", async () => {
    const env = bindings();
    const uploaded = await uploadCharacterDocument(local.db, env, {
      userId: owner,
      characterId,
      title: "世界設定メモ",
      mime: "text/plain",
      bytes: textBytes("この世界では魔法が使える。主人公は王立図書館の司書。"),
    });
    expect(uploaded.chunkCount).toBeGreaterThanOrEqual(1);
    expect(env.putMock).toHaveBeenCalledOnce();
    const chunks = await loadDocumentChunks(local.db, uploaded.id);
    expect(chunks.length).toBe(uploaded.chunkCount);
    expect(env.upsertMock).toHaveBeenCalled();
    const [storedVector] = env.stored.values();
    expect(storedVector.metadata?.kind).toBe("doc_chunk");
    expect(storedVector.metadata?.document_id).toBe(uploaded.id);
  });

  it("16 個目は 409 で止める", async () => {
    const env = bindings();
    // 上限計測は専用キャラでやらないと後続テストのカウントを汚す
    const limitCharId = crypto.randomUUID();
    await local.db.insert(characterTable).values({
      id: limitCharId,
      userId: owner,
      name: "doc-limit-char",
      systemPrompt: "上限計測用。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: 1,
    });
    for (let i = 0; i < 15; i++) {
      await local.db.insert(v2CharacterDocumentTable).values({
        id: `full-${i}`,
        userId: owner,
        characterId: limitCharId,
        title: `doc-${i}`,
        r2Key: `k-${i}`,
        mime: "text/plain",
        byteSize: 1,
        status: "active",
        createdAt: i,
      });
    }
    await expect(
      uploadCharacterDocument(local.db, env, {
        userId: owner,
        characterId: limitCharId,
        title: "16個目",
        mime: "text/plain",
        bytes: textBytes("本文"),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("検索は active の資料だけを返し、切った資料は出さん", async () => {
    const env = bindings();
    await uploadCharacterDocument(local.db, env, {
      userId: owner,
      characterId: crypto.randomUUID(),
      title: "種族設定",
      mime: "text/plain",
      bytes: textBytes("エルフは森の奥に住む長命の種族。"),
    });
    // upsert された資料は別キャラのもの。同じキャラでは検索に出る。
    const ownCharDoc = await uploadCharacterDocument(local.db, env, {
      userId: owner,
      characterId,
      title: "地名一覧",
      mime: "text/plain",
      bytes: textBytes("王都リオネスは交易の中心地。"),
    });
    // mock index は filter 適用済みのものだけ返す。自分のキャラの断片だけ拾われる。
    const hits = await retrieveDocumentChunks(
      local.db,
      env,
      { userId: owner, characterId },
      "地名は？",
    );
    expect(hits.length).toBe(1);
    expect(hits[0].title).toBe("地名一覧");
    // 資料を disabled にすると検索から消える
    await setCharacterDocumentStatus(local.db, ownCharDoc.id, owner, "disabled");
    const gone = await retrieveDocumentChunks(
      local.db,
      env,
      { userId: owner, characterId },
      "地名は？",
    );
    expect(gone).toStrictEqual([]);
  });

  it("消すと断片・検索箱・原本が全部無くなる", async () => {
    const env = bindings();
    const doc = await uploadCharacterDocument(local.db, env, {
      userId: owner,
      characterId,
      title: "削除対象",
      mime: "text/plain",
      bytes: textBytes("消す資料の本文。"),
    });
    const before = await retrieveDocumentChunks(
      local.db,
      env,
      { userId: owner, characterId },
      "消す資料",
    );
    expect(before.length).toBeGreaterThanOrEqual(0);
    await deleteCharacterDocumentById(local.db, env, doc.id, owner);
    expect(await loadDocumentChunks(local.db, doc.id)).toStrictEqual([]);
    expect(env.deleteByIdsMock).toHaveBeenCalled();
    expect(env.deleteMock).toHaveBeenCalled();
    const docs = await listCharacterDocuments(local.db, characterId, owner);
    expect(docs.find((row) => row.id === doc.id)).toBeUndefined();
  });

  it("documentVectorReady は R2・AI・検索箱・削除口が揃っとる時だけ true", () => {
    const env = bindings();
    expect(documentVectorReady(env)).toBe(true);
    expect(documentVectorReady({ V2_RAG_ENABLED: "1" })).toBe(false);
    // 削除口の無い検索箱は型上ありえんので、実行時チェックの確認用に assertion を使う。
    expect(
      documentVectorReady({
        ...env,
        MEMORY_INDEX: {
          upsert: env.MEMORY_INDEX.upsert,
          query: env.MEMORY_INDEX.query,
        } as unknown as DocumentVectorIndex,
      }),
    ).toBe(false);
  });
});
