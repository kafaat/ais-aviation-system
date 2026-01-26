/**
 * ESLint Configuration
 * 
 * Enforces code quality standards across the project.
 * Works with TypeScript and integrates with Prettier.
 */

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier", // Must be last to override other configs
  ],
  ignorePatterns: [
    "dist",
    "build",
    ".output",
    "node_modules",
    "coverage",
    "*.config.js",
    "*.config.cjs",
    "*.config.mjs",
    "drizzle/migrations",
  ],
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
    "no-return-await": "warn",
    "require-await": "warn",
  },
  overrides: [
    // Test files
    {
      files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
      env: {
        jest: true,
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "no-console": "off",
      },
    },
    // Configuration files
    {
      files: ["*.config.ts", "*.config.js", "vite.config.ts"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
  ],
};
