import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nehemiah/shared": fromRoot("./packages/shared/src/index.ts"),
      "@nehemiah/core": fromRoot("./packages/core/src/index.ts"),
      "@nehemiah/config": fromRoot("./packages/config/src/index.ts"),
      "@nehemiah/observability": fromRoot("./packages/observability/src/index.ts"),
      "@nehemiah/llm": fromRoot("./packages/llm/src/index.ts"),
      "@nehemiah/database": fromRoot("./packages/database/src/index.ts"),
      "@nehemiah/github": fromRoot("./packages/github/src/index.ts"),
      "@nehemiah/discord-kit": fromRoot("./packages/discord-kit/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/main.ts"],
    },
  },
});
