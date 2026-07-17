import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Integration tests hit the running dev API + shared database — run
    // serially so fixtures never race each other.
    fileParallelism: false,
  },
});
