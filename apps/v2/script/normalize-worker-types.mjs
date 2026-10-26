import { readFile, writeFile } from "node:fs/promises";

const target = new URL("../src/worker-configuration.d.ts", import.meta.url);
const content = await readFile(target, "utf8");
await writeFile(target, content.replace(/^\/\* eslint-disable \*\/\r?\n/u, ""));
