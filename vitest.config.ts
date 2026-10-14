import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      EMBEDDINGS_PROVIDER: "hash",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      STT_API_KEY: "",
      DATABASE_URL: "",
      UPLOAD_DIR: path.join(os.tmpdir(), "margin-test-uploads"),
      REGISTRATION_MODE: "first-user",
    },
  },
});
