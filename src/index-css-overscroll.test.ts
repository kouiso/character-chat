import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// 引っ張って更新が走るとアプリごとリロードされ、読んどる会話から追い出される(D11)。
// viewport へ効く overscroll-behavior は仕様上 root(html) から伝播する。Chrome も 140 で
// body からの伝播をやめたので、body だけに書いてあると抑止が丸ごと死ぬ。
// コメント本文が偽陽性を作らんように、比較の前に落とす。
const css = readFileSync(path.resolve(__dirname, "./index.css"), "utf8").replace(
  /\/\*[\S\s]*?\*\//g,
  "",
);

const HTML_RULE = /(?:^|\n)\s*html\s*{([^}]*)}/;
const BODY_RULE = /(?:^|\n)\s*body\s*{([^}]*)}/;

const ruleBody = (label: string, pattern: RegExp): string => {
  const matched = pattern.exec(css);
  if (!matched) throw new Error(`index.css に ${label} のルールが無い`);
  return matched[1];
};

describe("引っ張って更新の抑止が viewport まで届く", () => {
  it("html に overscroll-behavior: none がある", () => {
    expect(ruleBody("html", HTML_RULE)).toMatch(/overscroll-behavior:\s*none/);
  });

  // Chrome 139 以前は body から viewport へ伝播する。古い端末のために残す。
  it("body にも overscroll-behavior: none が残っとる", () => {
    expect(ruleBody("body", BODY_RULE)).toMatch(/overscroll-behavior:\s*none/);
  });
});
