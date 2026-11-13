import { defineConfig } from "@playwright/test";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error(
    "TEST_DATABASE_URL must point to a dedicated database ending in _test",
  );
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3002", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3002",
    url: "http://localhost:3002/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BETTER_AUTH_URL: "http://localhost:3002",
      BETTER_AUTH_SECRET:
        "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    },
  },
});
