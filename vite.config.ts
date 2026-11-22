import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Cloudflare plugin runs the Worker and the shared-world Durable Object inside
  // the dev server, so /ws works locally. Unit tests do not need it.
  plugins: process.env.VITEST ? [] : [cloudflare()],
  // Havok ships its own .wasm next to the ES module; pre-bundling would lose track of it.
  optimizeDeps: { exclude: ["@babylonjs/havok"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
