import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig(({ mode }) => {
  // Load test environment variables
  const env = loadEnv(mode || "test", templateRoot, "");

  return {
    plugins: [react()],
    root: templateRoot,
    resolve: {
      alias: {
        "@": path.resolve(templateRoot, "client", "src"),
        "@shared": path.resolve(templateRoot, "shared"),
        "@assets": path.resolve(templateRoot, "attached_assets"),
      },
    },
    test: {
      // Default environment for server tests
      environment: "node",
      include: [
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "client/**/*.test.tsx",
        "client/**/*.test.ts",
      ],
      // Configure different environments per file pattern
      environmentMatchGlobs: [
        // Use jsdom for client-side tests
        ["client/**/*.test.{ts,tsx}", "jsdom"],
        // Use node for server-side tests
        ["server/**/*.test.ts", "node"],
      ],
      // Setup file with conditional browser checks
      setupFiles: ["./client/src/test/setup.ts"],
      env: {
        // Provide test environment variables
        VITE_APP_ID: env.VITE_APP_ID || "ais-aviation-system-test",
        DATABASE_URL:
          env.DATABASE_URL ||
          "mysql://test:test@localhost:3306/ais_aviation_test",
        JWT_SECRET: env.JWT_SECRET || "test-jwt-secret-key",
        OAUTH_SERVER_URL: env.OAUTH_SERVER_URL || "http://localhost:3000",
        OWNER_OPEN_ID: env.OWNER_OPEN_ID || "test-owner-open-id",
        BUILT_IN_FORGE_API_URL:
          env.BUILT_IN_FORGE_API_URL || "https://api.manus.space",
        BUILT_IN_FORGE_API_KEY:
          env.BUILT_IN_FORGE_API_KEY || "test-forge-api-key",
        NODE_ENV: "test",
      },
      // Exclude directories from test search
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/.{idea,git,cache,output,temp}/**",
      ],
      // Coverage configuration
      coverage: {
        // Use v8 provider for native V8 coverage
        provider: "v8",
        // Enable coverage reporting (set to true via CLI --coverage flag)
        enabled: false,
        // Output directory for coverage reports
        reportsDirectory: "./coverage",
        // Coverage reporters
        reporter: [
          // Text output for terminal
          "text",
          // Text summary for quick overview
          "text-summary",
          // HTML report for detailed viewing
          "html",
          // LCOV format for CI tools (Codecov, Coveralls, etc.)
          "lcov",
          // JSON format for programmatic access
          "json",
          // JSON summary for badge generation
          "json-summary",
          // Cobertura format for some CI systems
          "cobertura",
        ],
        // Files to include in coverage
        include: [
          "server/**/*.ts",
          "client/src/**/*.ts",
          "client/src/**/*.tsx",
          "shared/**/*.ts",
        ],
        // Files to exclude from coverage
        exclude: [
          // Test files
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/*.spec.ts",
          "**/*.spec.tsx",
          "**/tests/**",
          "**/__tests__/**",
          "**/test/**",
          // Configuration files
          "**/vitest.config.ts",
          "**/vite.config.ts",
          "**/drizzle.config.ts",
          "**/tailwind.config.ts",
          "**/postcss.config.js",
          // Type definitions
          "**/*.d.ts",
          // Generated files
          "**/drizzle/migrations/**",
          // Node modules
          "**/node_modules/**",
          // Build output
          "**/dist/**",
          // Mock files
          "**/__mocks__/**",
          "**/mocks/**",
          // Setup files
          "**/setup.ts",
        ],
        // Minimum coverage thresholds
        // Set to 0 to prevent CI failures while building coverage baseline
        thresholds: {
          lines: 0,
          functions: 0,
          branches: 0,
          statements: 0,
        },
        // Clean coverage folder before running tests
        clean: true,
        // Skip files with no code coverage
        skipFull: false,
        // Report files with no tests
        all: true,
        // Process coverage for files even if no tests hit them
        extension: [".ts", ".tsx"],
        // Watermarks for coverage colors in HTML report
        // [yellow threshold, green threshold]
        watermarks: {
          statements: [50, 80],
          functions: [50, 80],
          branches: [50, 80],
          lines: [50, 80],
        },
      },
      // Global test timeout
      testTimeout: 10000,
      // Globals for testing-library matchers
      globals: true,
    },
  };
});
