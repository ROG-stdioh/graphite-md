// This file is JavaScript on purpose, and it is the only one left.
//
// Cucumber discovers its configuration from a fixed list of filenames:
// cucumber.js, cucumber.cjs, cucumber.mjs, cucumber.json, cucumber.yaml and
// cucumber.yml. `cucumber.ts` is not on that list, so renaming this file would
// not be a conversion — it would mean the suite silently ran with no
// configuration at all, and `strict` below would stop failing steps that match
// nothing. The list is in the installed package's configuration loader, not
// inferred.
//
// There is nothing here to type: it is data.
module.exports = {
  default: {
    // The step and support files are TypeScript, and Cucumber loads them
    // through its own ESM `import()`, which Node resolves and strips types
    // from. They stay CommonJS inside (see features/support/world.ts) — this
    // glob is the only thing that has to know they are `.ts`.
    import: ['features/support/**/*.ts', 'features/steps/**/*.ts'],
    format: ['progress'],
    strict: true,
  },
};
