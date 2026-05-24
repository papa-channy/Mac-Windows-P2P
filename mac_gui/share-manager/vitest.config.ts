import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts so that Tauri's dev server config stays
// uncluttered. Vitest discovers `tests/unit/**/*.test.{ts,tsx}` and
// runs them in jsdom against React Testing Library.

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
