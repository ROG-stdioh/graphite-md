// What @vscode/test-cli reads: which suite to run, and in which editor.
//
// `out/test/**` rather than `test/**`, because these files are loaded by a real
// VS Code — Node with a CommonJS loader and no idea what TypeScript is — so
// they are compiled before the runner starts. See test/tsconfig.json, the only
// program in this repo that emits; everything else here is a pure checker
// because esbuild does the emitting for the extension and the webview.
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',

  // The way into the preview's own page. VS Code is Electron, so this opens the
  // Chrome DevTools Protocol on localhost, where the webview appears in
  // `/json/list` as an iframe target with a debugger URL of its own — see
  // test/suite/cdp.ts for what connects to it and why that is the only way in.
  //
  // A fixed port rather than a random one, because the process that needs to
  // know it is the test suite, which runs *inside* the editor being launched: it
  // cannot be told a port the launcher picked, so both files carry the number.
  // Two suites running at once on one machine is the one collision this allows,
  // and on this machine (and a CI runner) there is only ever one.
  launchArgs: ['--remote-debugging-port=9333'],

  // Pinned to the floor of `engines.vscode`, deliberately. `stable` would test
  // the newest editor and say nothing about the oldest one the Marketplace is
  // still offering this extension to — and it is the oldest that breaks first,
  // since every API this extension uses that arrived after it is one a user on
  // that version does not have.
  version: '1.134.0',

  mocha: {
    // The TDD interface, which is what this repo's other suite idiom compiles
    // to anyway: a named suite with named tests inside it.
    ui: 'tdd',
    // A ceiling on the whole suite's patience rather than a number any test
    // should approach. A cold first run downloads and unzips an editor before
    // the extension host even starts.
    timeout: 60_000,
  },
});
