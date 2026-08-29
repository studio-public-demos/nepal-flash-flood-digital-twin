import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npx http-server . -p 4179 -c-1",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
