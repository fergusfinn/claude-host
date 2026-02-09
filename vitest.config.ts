import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { NODE_ENV: "test", AUTH_DISABLED: "1" },
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts", "server.ts"],
      exclude: ["lib/claude-bridge.ts", "lib/markdown.tsx", "lib/themes.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
