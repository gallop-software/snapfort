import { defineConfig } from "vitest/config";

export default defineConfig({
  // Havok ships its own .wasm next to the ES module; pre-bundling would lose track of it.
  optimizeDeps: { exclude: ["@babylonjs/havok"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
