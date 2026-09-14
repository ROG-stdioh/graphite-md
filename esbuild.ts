import type { BuildOptions } from 'esbuild';

// Required rather than imported, here and in every other file in this program.
// These files are loaded by Node directly as CommonJS: a value `import` would
// make the file ESM, and ESM has no `module.exports` and no `require.main`, so
// the two things that make this file both a script and a module would stop
// working. @types/node types `require` as returning `any`, and the cast is what
// reattaches the module's real type. It is an assertion — but TypeScript cannot
// infer a module's shape from a `module.exports` assignment, so it is the only
// one available, and `import type` (which is erased, and so cannot affect the
// module format) keeps the types themselves derived rather than restated.
const esbuild = require('esbuild') as typeof import('esbuild');

const watch = process.argv.includes('--watch');

// Two bundles, two contexts — not one context with two entryPoints. Multiple
// entry points make `outfile` illegal and force `format` and `external` to be
// shared, and these two need opposite settings: cjs/node with `vscode` left
// external for the extension host, iife/browser with nothing external for the
// webview, which has no module system to load a dependency from.
//
// `satisfies` rather than a `: BuildOptions` annotation: both reject a mistyped
// key, but `satisfies` keeps each object's own literal types, so the values
// below are still checked against what they claim to be.
const HOST = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
} satisfies BuildOptions;

const WEBVIEW = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'media/preview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
  logLevel: 'warning',
} satisfies BuildOptions;

/**
 * Builds media/preview.js.
 *
 * It is generated output and gitignored, and scripts/graph-check.ts reads it
 * from disk — so the checks rebuild it here, through this same options object,
 * rather than testing whatever bytes the last build happened to leave behind.
 * That staleness is the bug features/support/world.ts already documents for its
 * own bundle, and the reason this file stopped being committed.
 *
 * Synchronous so graph-check can call it from its CommonJS top level without
 * making the whole script async. Watch mode does not go through here: it needs
 * a long-lived context, created from these same options so the two cannot
 * drift apart.
 */
function buildWebview(): void {
  esbuild.buildSync(WEBVIEW);
}

async function main(): Promise<void> {
  if (watch) {
    const hostCtx = await esbuild.context(HOST);
    const webviewCtx = await esbuild.context(WEBVIEW);
    await hostCtx.watch();
    await webviewCtx.watch();
    console.log('esbuild: watching for changes...');
    return;
  }
  await esbuild.build(HOST);
  buildWebview();
}

// Guarded: scripts/graph-check.ts requires this file for buildWebview, and
// loading it must not kick off a build of the extension.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildWebview };
