import { defineConfig, devices } from "@playwright/test";

// Tauri-less E2E — runs against `npm run dev` (Vite) with the Tauri
// invoke bridge stubbed by tests/e2e/fixtures/mock-tauri.ts. Catches
// ~95% of UI regressions without needing the real .app.

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5273",
    trace: "retain-on-failure",
    viewport: { width: 1320, height: 880 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "PW_DEV_PORT=5273 npm run dev",
    url: "http://localhost:5273",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
