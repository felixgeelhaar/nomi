import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  // Ignore build output, Rust target, e2e artifacts, and Tauri-generated code.
  // Also ignore the ESLint config itself so it doesn't re-lint itself with
  // project-aware parsing rules that don't apply.
  {
    ignores: [
      "dist/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "test-results/**",
      "playwright-report/**",
      "node_modules/**",
      "eslint.config.js",
      "vite.config.ts",
      "playwright.config.ts",
      // Playwright e2e tests run in Node + a real browser, not React. The
      // React-hooks rules misfire on Playwright's `use` fixture callback
      // and `no-empty-pattern` flags `{}` for fixtures that don't
      // destructure. Linting here offers no React-specific value.
      "e2e/**",
    ],
  },

  // Base JS/TS rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + hooks + fast-refresh
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // React core
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,

      // Hooks — exhaustive-deps as error catches the stale-closure bugs
      // the code review found (chat-interface interval captures, etc.)
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // Fast-refresh
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Strictness: no silent `any`, unused vars flagged (allow leading _)
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // React 19 no longer needs React in scope for JSX
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },

  // Tests get jest-dom globals + relaxed rules where they naturally apply
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
