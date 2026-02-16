import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["dist/", "node_modules/", "coverage/", "frontend/"],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (type-aware linting disabled for speed)
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Relax unused vars — allow _-prefixed names
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // Allow console in a Node.js backend
      "no-console": "off",

      // Allow explicit `any` — too many to fix in one pass
      "@typescript-eslint/no-explicit-any": "off",

      // Allow `require` imports (some dynamic imports use this)
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
