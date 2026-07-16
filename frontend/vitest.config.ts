import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**", "out/**", ".next/**"],
  },
});
