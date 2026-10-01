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

// Instrumented builds carry the timing in src/shared/perf.ts; every other build
// strips it. Opt-in rather than implied by `--watch`, because a normal watch
// build prints nothing today and a profiler that starts narrating every
// keystroke into the Extension Host output is a change nobody asked for.
//
// `npm run build:profile` / `npm run watch:profile` turn it on, and the
// "Run graphite.md (profiling)" launch config in .vscode/launch.json exists
// because F5's default preLaunchTask would otherwise rebuild with the flag off
// and quietly overwrite an instrumented tree.
const profile = process.argv.includes('--profile');

// The `define` below is what makes the flag free. esbuild substitutes the
// identifier textually, so a release bundle carries `if (false)` at every entry
// point in perf.ts and the minifier drops the bodies — the instrumentation
// costs an instrumented build nothing and a shipped one nothing at all.
// scripts/package-check.ts greps the packaged preview.js for the marker rather
// than trusting that.
function defines(profiling: boolean): Record<string, string> {
  return { __PROFILE__: String(profiling) };
}

// Two bundles, two contexts — not one context with two entryPoints. Multiple
// entry points make `outfile` illegal and force `format` and `external` to be
// shared, and these two need opposite settings: cjs/node with `vscode` left
// external for the extension host, iife/browser with nothing external for the
// webview, which has no module system to load a dependency from.
//
// Functions rather than two constants, because each bundle now exists in two
// variants. They take the flag as an argument rather than reading the module
// scope, so buildWebview below can pin the release variant deliberately.
function hostOptions(profiling: boolean): BuildOptions {
  return {
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
    define: defines(profiling),
  };
}

function webviewOptions(profiling: boolean): BuildOptions {
  return {
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    outfile: 'media/preview.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    minify: !watch,
    logLevel: 'warning',
    define: defines(profiling),
  };
}

/**
 * Builds media/preview.js.
 *
 * It is generated output and gitignored, and scripts/graph-check.ts reads it
 * from disk — so the checks rebuild it here, through these same options,
 * rather than testing whatever bytes the last build happened to leave behind.
 * That staleness is the bug features/support/world.ts already documents for its
 * own bundle, and the reason this file stopped being committed.
 *
 * Pinned to the release variant, deliberately: the checks should drive the
 * bytes that ship, and an instrumented preview.js would print its profile into
 * the middle of their output.
 *
 * Synchronous so graph-check can call it from its CommonJS top level without
 * making the whole script async. Watch mode does not go through here: it needs
 * a long-lived context, and it may want a different variant than this one.
 */
function buildWebview(): void {
  esbuild.buildSync(webviewOptions(false));
}

async function main(): Promise<void> {
  if (watch) {
    const hostCtx = await esbuild.context(hostOptions(profile));
    const webviewCtx = await esbuild.context(webviewOptions(profile));
    await hostCtx.watch();
    await webviewCtx.watch();
    console.log(`esbuild: watching for changes (profiling ${profile ? 'on' : 'off'})...`);
    return;
  }
  await esbuild.build(hostOptions(profile));
  esbuild.buildSync(webviewOptions(profile));
  if (profile) console.log('esbuild: built with profiling instrumentation.');
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
