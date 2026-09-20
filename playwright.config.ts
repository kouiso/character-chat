import { defineConfig, devices } from "playwright/test";

/**
 * Playwright configuration for character-chat e2e tests (#185).
 *
 * Port 5185 is used to avoid collision with other sessions on 5173.
 * Viewport defaults to iPhone SE (375×667) — mobile-first per project convention.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5185",
    viewport: { width: 375, height: 667 },
    // Use auto-wait everywhere — no manual sleeps
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // Spawn Vite dev server on port 5185 for e2e runs.
  // SKIP_E2E_SERVER=1 to use an already-running server (e.g. a different port).
  // E2E_BASE_URL overrides the default base URL (useful when 5185 is taken by another worktree).
  webServer: process.env["SKIP_E2E_SERVER"]
    ? undefined
    : {
        command: "pnpm vite --port 5185 --host",
        url: process.env["E2E_BASE_URL"] ?? "http://localhost:5185",
        reuseExistingServer: !process.env["CI"],
        timeout: 60_000,
      },
});
