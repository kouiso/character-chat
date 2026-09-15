/** @type {import('jest').Config} */
// @v2/* は node_modules 配下が packages/*/src への symlink なので、
// realpath ベースの transformIgnorePatterns(node_modules) には引っかからず変換される。
const config = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } }, module: { type: "commonjs" } },
    ],
  },
};

export default config;
