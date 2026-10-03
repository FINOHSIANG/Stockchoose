import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:18973",
    trace: "on-first-retry"
  },
  webServer: {
    command: "cross-env STOCKCHOOSE_BUN_PORT=18083 STOCKCHOOSE_BUN_API_URL=http://127.0.0.1:18083 STOCKCHOOSE_AGENT_AUTH_FILE=tmp/agent-runtime/playwright-sidecar-auth npm run dev:web -- --port 18973 --strictPort",
    url: "http://127.0.0.1:18973",
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
    }
  ]
});
