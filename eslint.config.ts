// Loaded by jiti, which ESLint requires for a TypeScript config file — see the
// devDependency note in package.json. Written in CommonJS to match every other
// file in the tooling program, since jiti transpiles either form.
const tseslint = require('typescript-eslint') as typeof import('typescript-eslint');
// `defineConfig`, not `tseslint.config()`. Both flatten the preset array and
// both accept `extends`, but the helper typescript-eslint shipped for this is
// deprecated in 8.70 in favour of ESLint's own — its notice says so in as many
// words, and `no-deprecated` enforces it. The presets below are still
// typescript-eslint's; only the wrapper is core's.
const { defineConfig } = require('eslint/config') as typeof import('eslint/config');

// The two programs' file sets, named once so that no block below can come to
// disagree with the one beside it about what the tooling is. See tsconfig.json
// for HOST and tsconfig.node.json for TOOLING.
const HOST = ['src/**/*.ts'];
const TOOLING = ['esbuild.ts', 'eslint.config.ts', 'scripts/**/*.ts', 'features/**/*.ts'];

module.exports = defineConfig(
  {
    ignores: [
      // The one file in the repo that is still JavaScript, and it has to be.
      // Cucumber 13.2.1 discovers its configuration from a fixed list of
      // filenames — cucumber.js, .cjs, .mjs, .json, .yaml, .yml — and
      // cucumber.ts is not among them, so converting it would mean the suite
      // silently stopped being configured. Verified against the installed
      // package's own loader rather than assumed. It is 20 lines of data with
      // no logic, so nothing type-aware is lost.
      'cucumber.js',
      // Generated: media/preview.js is the webview bundle, media/vendor/** is
      // copied out of node_modules. Neither is source.
      'media/**',
      'out/**',
      'node_modules/**',
      'docs/**',
      'samples/**',
    ],
  },

  // Type-aware rules. Every rule in this preset needs a real TS program, which
  // is why it costs about as much as a tsc run — and why wiring up `tsc` was
  // worth doing first.
  ...tseslint.configs.strictTypeChecked,

  // Rules whose reason does not depend on which program a file is in, so they
  // are written once and apply to both. That is the point: these two were
  // written for src/ alone, and the tooling then reported 15 errors between
  // them for doing exactly what src/ is allowed to do.
  {
    files: [...HOST, ...TOOLING],
    rules: {
      // The message protocol is a discriminated union joined by `type`. This is
      // the rule that fails when a variant is added and one side of the
      // boundary is not updated — the exact bug the shared protocol type exists
      // to prevent.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // strictTypeChecked turns this rule's allowNumber off. src/ builds HTML
      // by concatenation — `id="table-${n}"`, `<h${level}>`,
      // `data-line="${line}"` — and the tooling builds its messages the same
      // way: `expected ${n} rows, found ${found}`. In both, the digits are the
      // entire intent and String(n) is locale-independent, so no formatting
      // decision is being skipped. Every site is an identity number: a counter,
      // an index, a heading level, a source line, a tally in a PASS/FAIL line.
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
  },

  // The extension host, webview included — resolved the way the editor's TS
  // server resolves it, by nearest tsconfig: src/** lands in tsconfig.json and
  // src/webview/** in src/webview/tsconfig.json, the config that gives those
  // files the DOM lib and withholds the node types.
  {
    files: HOST,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },

  {
    // The tooling program — see tsconfig.node.json. It is linted with its own
    // project now, which is what the earlier `**/*.js` ignore was waiting for.
    files: TOOLING,
    languageOptions: {
      parserOptions: {
        // `project`, not `projectService`, and the difference is not cosmetic.
        // The project service resolves a file to its *nearest* tsconfig, the
        // way the editor's TS server does — and the nearest config to
        // esbuild.ts, eslint.config.ts, scripts/** and features/** is the
        // root tsconfig.json, which is the extension host program and
        // deliberately includes only src/**. So every file in this block
        // resolves to a project that does not contain it, and each type-aware
        // rule dies with "you have used a rule which requires type information,
        // but don't have parserOptions set to generate type information for
        // this file" — naming the rule, not the real cause. Naming the program
        // removes the guess.
        //
        // A tsconfig.json that still carried the default `**/*` include would
        // hide this by sweeping the tooling into the host program, which is the
        // wrong environment for it: that is how the nine TS6059s showed up.
        project: ['./tsconfig.node.json'],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // The one rule this program structurally cannot satisfy, and the reason
      // it is turned off here rather than at the top level where it would also
      // stop guarding src/.
      //
      // These files are CommonJS because Node loads them directly: `node
      // scripts/graph-check.ts`, cucumber's glob over features/**, and the
      // `require.main` guard in esbuild.ts all depend on it. Switching them to
      // ESM is not available — a `.ts` file with import syntax, in a package
      // with no "type" field, makes Node warn MODULE_TYPELESS_PACKAGE_JSON and
      // reparse the file as ESM on every single run, and it would take
      // `module.exports` and `require.main` with it. So the rule's premise,
      // "prefer ESM imports", does not hold for any file in this list.
      //
      // src/ is unaffected: it is bundled by esbuild and imports normally, and
      // this rule still applies there.
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
