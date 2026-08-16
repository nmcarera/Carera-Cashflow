import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the one real-browser smoke test this app has
 * (e2e/household-flow.spec.ts): import a statement, correct a
 * transaction, and confirm the dashboard picks it up — the seam between
 * every phase, exercised together the way a household actually would.
 *
 * `webServer` builds and starts a production server against a disposable
 * database (see e2e/setup.ts), so this never touches data/carera-cashflow.db.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3101",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // This sandbox pre-installs Chromium rather than letting Playwright
        // download its own — see AGENTS.md / the environment notes on
        // PLAYWRIGHT_BROWSERS_PATH. Pointing at it directly keeps `npx
        // playwright test` working without a network fetch.
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
  ],
  webServer: {
    command: "tsx e2e/setup.ts && next build && next start -p 3101",
    url: "http://localhost:3101",
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      CARERA_DB_PATH: "./e2e/.e2e-data/carera-cashflow.db",
    },
  },
});
