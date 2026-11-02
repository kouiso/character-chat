// @vitest-environment node
import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("ルート宣言の生成", () => {
  it("型付きのルート一覧を保ち、禁止された型を出力しない", () => {
    const source = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
    const tree = ts.createSourceFile("routeTree.gen.ts", source, ts.ScriptTarget.Latest, true);
    const unsafeTypes: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) unsafeTypes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(unsafeTypes).toEqual([]);
    expect(source).toContain("interface FileRoutesByFullPath");
    expect(source).toContain("'/characters/new'");
    expect(source).toContain("'/characters/$id'");
    expect(source).toContain("'/chat/$id'");
  });
});
