import { defineConfig, devices } from "@playwright/test";

// E2E (the frozen /embed page) against the dev server: the embed reads only its packed file, so no
// data version is needed. Run: npm run e2e (first: npm run e2e:install).
const PORT = Number(process.env.E2E_PORT ?? 4327);

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/embed`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
