import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // The RSC poison-pill throws outside a Server Component; tests exercise
      // pure functions from server modules, so it is stubbed out here.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
  test: { include: ["lib/**/*.test.ts", "tests/**/*.test.ts"] },
});
