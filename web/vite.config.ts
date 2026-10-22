import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { preloadMap } from "./scripts/vite-preload-map.ts";
import { akariThemeInit } from "./scripts/vite-theme-init.ts";

// Commit shown in the footer: CI sets BUILD_SHA or GITHUB_SHA; the local checkout is the fallback.
function commitSha(): string {
  const fromEnv = process.env.BUILD_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Akari's pre-paint theme script (shared krtmtthw.dev theme cookie), served from our own origin.
    akariThemeInit(),
    // <link rel=modulepreload> for the lazy MapPage/MapView chunks and the MapLibre worker (every page shows the map).
    preloadMap(),
  ],
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  // scripts/deploy-web.sh builds from a staged copy of public/ (no local data/ dev links, fresh WASM).
  publicDir: process.env.LIGHTS_PUBLIC_DIR ?? "public",
  worker: { format: "es" },
  // MapLibre 6 resolves its worker file relative to its own module; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    target: "es2023",
    chunkSizeWarningLimit: 1100, // maplibre-gl is one ~1 MB chunk, loaded only with the map
    // Two pages, one build: /embed (the frozen view krtmtthw.dev frames) shares the app's hashed chunks.
    rollupOptions: { input: { main: "index.html", embed: "embed.html" } },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    maxWorkers: 2,
  },
});
