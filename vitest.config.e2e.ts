import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: { NODE_ENV: "test", AUTH_DISABLED: "1" },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
