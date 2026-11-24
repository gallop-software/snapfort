import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vitest/config";

/**
 * This build's version, the same in the page and the Worker: a page from an
 * older build is told to restart (see BUILD_ID in src/net/protocol.ts). Set
 * once by `npm run build`: Vite reads this file again for the Worker's build a
 * few seconds later, and a time taken here would then differ between the two.
 */
const BUILD = process.env.SNAPFORT_BUILD ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  // The Cloudflare plugin runs the Worker and the shared-world Durable Object inside
  // the dev server, so /ws works locally. Unit tests do not need it.
  plugins: process.env.VITEST ? [] : [cloudflare()],
  // Havok ships its own .wasm next to the ES module; pre-bundling would lose track of it.
  optimizeDeps: { exclude: ["@babylonjs/havok"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
  // Shared rules in tests/; each world keeps its own tests in its folder.
  test: { include: ["tests/**/*.test.ts", "src/worlds/**/*.test.ts"], environment: "node" },
});
