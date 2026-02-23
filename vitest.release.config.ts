import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    include: [
      "tests/unit/auth-middleware.test.ts",
      "tests/unit/session-auth.test.ts",
      "tests/permissions.test.ts",
      "tests/integration/permissions.integration.test.ts",
      "tests/integration/self-service-auth-session.integration.test.ts",
      "tests/billing.test.ts",
      "tests/billing-handlers.test.ts",
      "tests/unit/page-password-security.test.ts",
      "tests/unit/public-page-password-route.test.ts",
      "tests/unit/platform-routes.test.ts",
      "src/api/platform-routes.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: [
        "src/middleware/auth.ts",
        "src/middleware/session-auth.ts",
        "src/middleware/permissions.ts",
        "src/middleware/billing.ts",
        "src/services/landing-page-editor.ts",
        "src/api/public-page-renderer.ts",
        "src/api/platform-routes.ts",
      ],
      thresholds: {
        statements: 52,
        lines: 54,
        functions: 47,
        branches: 43,
      },
    },
  },
});
