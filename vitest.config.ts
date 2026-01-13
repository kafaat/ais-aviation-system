import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnv } from "vite";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig(({ mode }) => {
  // Load test environment variables
  const env = loadEnv(mode || "test", templateRoot, "");

  return {
    root: templateRoot,
    resolve: {
      alias: {
        "@": path.resolve(templateRoot, "client", "src"),
        "@shared": path.resolve(templateRoot, "shared"),
        "@assets": path.resolve(templateRoot, "attached_assets"),
      },
    },
    test: {
      environment: "node",
      include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
      env: {
        // Provide test environment variables
        VITE_APP_ID: env.VITE_APP_ID || "ais-aviation-system-test",
        DATABASE_URL:
          env.DATABASE_URL ||
          "mysql://test:test@localhost:3306/ais_aviation_test",
        JWT_SECRET: env.JWT_SECRET || "test-jwt-secret-key",
        OAUTH_SERVER_URL: env.OAUTH_SERVER_URL || "https://oauth.manus.space",
        OWNER_OPEN_ID: env.OWNER_OPEN_ID || "test-owner-open-id",
        BUILT_IN_FORGE_API_URL:
          env.BUILT_IN_FORGE_API_URL || "https://api.manus.space",
        BUILT_IN_FORGE_API_KEY:
          env.BUILT_IN_FORGE_API_KEY || "test-forge-api-key",
        NODE_ENV: "test",
      },
    },
  };
});
