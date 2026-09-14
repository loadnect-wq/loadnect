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
      // AGENT WORKTREES ARE FULL COPIES OF THIS REPO. Tooling checks out a
      // branch under .claude/worktrees/<name>/, so every source file exists
      // twice — and eslint linted both. That took `npm run lint` from
      // "0 errors, 123 warnings" to 36,686 errors overnight, none of them in
      // code anyone had written: they were duplicate reports against a second
      // copy of the tree, plus its own vendored deps.
      //
      // The damage is not the number, it is that a real error can no longer be
      // seen in it. Ignored wholesale — nothing under .claude/ is shipped.
      ".claude/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Leading underscore is the project's "deliberately unused" marker —
      // used for destructuring-to-omit (`const { secret: _omitted, ...rest }`)
      // as well as for arguments.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "react/display-name": "off",
      // The 42703 fallback pattern destructures { data, error } with let and
      // reassigns `data` in the fallback branch. Only flag prefer-const when
      // ALL destructured members are const-able (standard, sensible setting).
      "prefer-const": ["error", { destructuring: "all" }],
      // These two ship newly-strict in Next 16's bundled react-hooks plugin.
      //
      // An earlier version of this comment said satisfying them "risks
      // SSR/hydration regressions" and deferred the work. That turned out to be
      // backwards: every site they flagged HAS now been converted, and the
      // conversions removed hydration hazards rather than creating them —
      // localStorage and matchMedia are external stores, so useSyncExternalStore
      // reads them with an explicit server snapshot instead of painting a wrong
      // value and correcting it after mount; clock reads moved out of render to
      // one instant per page, which is also what stops two rows of the same
      // table disagreeing about "now".
      //
      // Kept at "warn" rather than "error" only because a future flagged site
      // should be a prompt to think, not a blocked build. NOT security-related.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
