// BDD suite configuration. Run with `npm run test:bdd`.
//
// The suite is deliberately separate from scripts/render-check.js and
// scripts/graph-check.js. Those are developer smoke tests: fast, and written
// against the implementation ("hljs spans present", "footnote ref anchors
// match"). This suite is written in the language of someone using the
// preview, so it can answer a different question — not "does the code still
// do what it did?" but "does the product still behave the way we say it
// does?". Features live in features/*.feature; the steps that drive them live
// in features/steps, and the shared world in features/support.
module.exports = {
  default: {
    import: ['features/support/**/*.js', 'features/steps/**/*.js'],
    format: ['progress'],
    // Fail the run on a step that has no definition. Without this, a typo in
    // a step name silently reports as "pending" and the suite still goes
    // green — which is the one failure mode a test suite must not have.
    strict: true,
  },
};
