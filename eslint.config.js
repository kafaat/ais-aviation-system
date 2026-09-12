/**
 * ESLint Configuration (Flat Config for ESLint 9+)
 *
 * Enforces code quality standards across the project.
 * Works with TypeScript and integrates with Prettier.
 */

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

export default [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "build/**",
      ".output/**",
      "node_modules/**",
      "coverage/**",
      "drizzle/migrations/**",
      ".archive/**",
      "*.config.js",
      "*.config.cjs",
      "*.config.mjs",
    ],
  },

  // Main configuration for TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        queueMicrotask: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        crypto: "readonly",
        btoa: "readonly",
        atob: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript specific rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
        },
      ],

      // General rules
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unused-expressions": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],

      // Best practices
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "require-await": "warn",
    },
  },

  // Test files configuration. scripts/acceptance is the acceptance suite: it
  // refuses to run without AIS_DISPOSABLE_DATABASE outside production, and no
  // server or client module imports it.
  {
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/__tests__/**",
      "scripts/acceptance/**",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      // A test double for an async API is legitimately `async` with nothing to
      // await: `vi.fn(async () => row)` models the real signature. Satisfying
      // the rule would mean making the double return a bare value, so it would
      // no longer resemble what it stands in for. The rule stays on for source.
      "require-await": "off",
      // A wrong assertion here fails the test that exists to catch it, which is
      // the outcome the rule protects against everywhere else. Keeping it on
      // would leave ~110 warnings nobody acts on, which is what let the backlog
      // grow unnoticed before. It stays on for every non-test path, where the
      // cap is now zero.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Prettier config (must be last)
  prettierConfig,
];
