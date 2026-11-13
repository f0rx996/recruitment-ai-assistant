import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
