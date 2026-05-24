import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and ignores the hmr port from process.env
// when it detects this config file.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    // Playwright (and other parallel envs) can override the port via
    // PW_DEV_PORT — Tauri itself always wants 5173 so we only relax
    // strictPort when the override is set.
    port: process.env.PW_DEV_PORT ? Number(process.env.PW_DEV_PORT) : 5173,
    strictPort: !process.env.PW_DEV_PORT,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "safari14",
    minify: (process.env.TAURI_DEBUG ? false : "esbuild") as "esbuild" | false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
