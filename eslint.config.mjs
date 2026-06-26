// Flat ESLint config for Next.js 16 + TypeScript.
//
// NOTE: the previous version used `FlatCompat(...).extends("next/core-web-vitals",
// "next/typescript")`. Under ESLint 9.39 that path crashes inside
// @eslint/eslintrc with "Converting circular structure to JSON" while loading
// the Next shareable config. eslint-config-next 16 ships NATIVE flat-config
// arrays, so we import them directly and skip the compat shim entirely.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Don't lint build output, deps, or generated types.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/display-name": "off",
      // The 42703 fallback pattern destructures { data, error } with let and
      // reassigns `data` in the fallback branch. Only flag prefer-const when
      // ALL destructured members are const-able (standard, sensible setting).
      "prefer-const": ["error", { destructuring: "all" }],
      // These two rules ship newly-strict in Next 16's bundled react-hooks
      // plugin. They fire on INTENTIONAL, working patterns:
      //   • set-state-in-effect — reading localStorage / matchMedia in an
      //     effect after mount (the SSR-safe way; can't read them during render
      //     without a hydration mismatch).
      //   • purity — computing a date range with new Date() during render,
      //     including inside async Server Components where it's perfectly fine.
      // Refactoring working code to satisfy them (e.g. useSyncExternalStore)
      // risks SSR/hydration regressions, so we surface them as warnings to
      // review later rather than block on them. NOT security-related.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
