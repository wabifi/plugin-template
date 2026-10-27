import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "plugins/*/core/**/*.test.ts",
      "plugins/*/desktop/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
