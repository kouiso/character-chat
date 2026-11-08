import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/schema/index.ts", "./packages/db/src/v2-schema.ts"],
  out: "./drizzle",
  dialect: "sqlite",
  migrations: { prefix: "timestamp" },
});
