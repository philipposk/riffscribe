import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  {
    ignores: [
      ".next/**",
      "public/**",
      "vendor/**",
      "mobile/**",
      "node_modules/**",
      "scripts/eval-cello/out/**",
      "scripts/eval-cello/.cache/**",
      "next-env.d.ts",
    ],
  },
  {
    // Existing source has a few `eslint-disable @typescript-eslint/no-explicit-any`
    // comments for a rule this config does not load; they are harmless.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    // Same files as the react-hooks plugin's own block, or eslint cannot find the plugin
    // for other file types (such as the .cjs Basic Pitch loader in scripts/eval-cello/lib).
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // The four rules below flag patterns that already exist in working code
      // (React 19 compiler-era checks). Kept as warnings so new code sees them
      // without a rewrite of existing components; tighten them when those are reworked.
      // Existing code syncs props/storage into state from effects.
      "react-hooks/set-state-in-effect": "warn",
      // Existing hooks read and write refs during render for engine handles.
      "react-hooks/refs": "warn",
      // Existing render code reads Date.now()/Math.random() for ids and timers.
      "react-hooks/purity": "warn",
      // Apostrophes in one existing legal-style sentence.
      "react/no-unescaped-entities": "warn",
    },
  },
];

export default config;
