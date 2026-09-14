const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    // Only src/ is in a TypeScript program yet. The tooling — scripts/,
    // features/, esbuild.js, cucumber.js — has no tsconfig, and projectService
    // errors on files that no project owns rather than linting them loosely. It
    // gains a project in the follow-up that converts it to TypeScript, and gets
    // linted then. media/preview.js is source too, but it moves into the
    // webview program in the same pass. When either lands, drop the matching
    // pattern here or the file is silently linted nowhere.
    ignores: ['**/*.js', '**/*.mjs', 'out/**', 'node_modules/**', 'docs/**', 'samples/**'],
  },

  // Type-aware rules. Every rule in this preset needs a real TS program, which
  // is why it costs about as much as a tsc run — and why wiring up `tsc` was
  // worth doing first.
  ...tseslint.configs.strictTypeChecked,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // The message protocol is a discriminated union joined by `type`. This is
      // the rule that fails when a variant is added and one side of the
      // boundary is not updated — the exact bug the shared protocol type exists
      // to prevent.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // strictTypeChecked turns this rule's allowNumber off. This project
      // builds HTML by concatenation — `id="table-${n}"`, `<h${level}>`,
      // `data-line="${line}"` — where the digits are the entire intent, and
      // String(n) is locale-independent, so no formatting decision is being
      // skipped. Every site is an identity number: a counter, an index, a
      // heading level, a source line.
      //
      // Every other option is restated deliberately, because flat config
      // replaces a rule's options wholesale rather than merging them with the
      // preset's, and this rule's own defaults are all `true` — writing only
      // `{ allowNumber: true }` would quietly drop allowAny, allowBoolean,
      // allowNullish and allowRegExp back to permissive and undo most of what
      // the preset bought. `allow` is the preset's value, not the default's.
      //
      // If a number that is *measured* — a width, a duration, a byte count —
      // ever needs interpolating, format it at that site instead of leaning on
      // this.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allow: [{ name: ['Error', 'URL', 'URLSearchParams'], from: 'lib' }],
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
    },
  }
);
