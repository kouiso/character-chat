import { defineConfig, globalIgnores } from "eslint/config";

import rootConfig from "./eslint.config.js";

// v2 monorepo（apps/v2, packages/*）専用の eslint 設定。
// root の globalIgnores（apps/, packages/ を除外する側）だけを外し、
// 残りの rules 一式（tseslint recommended, react, security 等）を再利用する。
const rootConfigWithoutGlobalIgnores = rootConfig.filter(
  (entry) => !("ignores" in entry && !("files" in entry)),
);

export default defineConfig([
  ...rootConfigWithoutGlobalIgnores,

  globalIgnores(["**/routeTree.gen.ts", "**/.output/**", "**/dist/**", "**/node_modules/**"]),

  {
    // Vite/Vitest/Jest の設定ファイルは default export が仕様。
    // vitest.config.ts は各パッケージの tsconfig.json の include に入れて projectService に拾わせる。
    files: ["vite.config.ts", "vitest.config.ts", "jest.config.mjs"],
    rules: {
      "import/no-default-export": "off",
    },
  },

  {
    // @v2/engine の Jest テストは tsconfig.json（src のみ）やのうて tsconfig.jest.json に属する。
    // projectService は最寄りの tsconfig.json しか見んので、このファイル群だけ project を
    // 明示して型情報を与える。jest.config.mjs は TS やないのでこの対象から外れる。
    files: ["__tests__/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["packages/engine/tsconfig.jest.json"],
      },
    },
  },

  {
    // @v2/bench（run.ts）は CLI で console が唯一の出力手段。
    // 各パッケージは `eslint --config ../../eslint.v2.config.js .` を自分のディレクトリを
    // cwd にして実行するので、files のグロブは実行時 cwd からの相対パスで書く
    // （config ファイルの場所からの相対パスやない）。ファイル名がパッケージ内で
    // 一意なので、他パッケージへ誤爆せん。
    files: ["src/run.ts", "src/persist-check.ts", "src/script-run.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    // @v2/cf（check.ts）は D1 疎通確認 CLI で console が唯一の出力手段。
    files: ["src/check.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    // TanStack Router のファイルベースルートは loader 等の named export を画面と同居させる
    files: ["src/routes/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
