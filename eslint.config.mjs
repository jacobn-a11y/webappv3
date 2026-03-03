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
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow `require` imports (some dynamic imports use this)
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Production-path type-safety guardrail (T14)
  {
    files: [
      "src/api/dashboard/**/*.{ts,mts,cts}",
      "src/api/setup/**/*.{ts,mts,cts}",
      "src/api/ai-settings/**/*.{ts,mts,cts}",
      "src/services/**/*.{ts,mts,cts}",
      "src/integrations/**/*.{ts,mts,cts}",
    ],
    ignores: ["**/*.test.ts", "**/*.test.mts", "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[typeAnnotation.type='TSAnyKeyword']",
          message:
            "Do not use `as any` in production paths. Add a typed boundary or explicit narrow type.",
        },
        {
          selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Do not chain `as unknown as` in production paths. Decode or narrow the value explicitly.",
        },
      ],
    },
  },
);
