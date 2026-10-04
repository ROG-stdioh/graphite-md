// Golden-file check for the renderer: bundles src/markdown.ts with esbuild,
// renders every document in samples/, and compares the output byte for byte
// against the committed HTML in samples/golden/.
//
// The named scenarios state one behaviour each and prove it; a scenario can
// only catch a change to something somebody thought to write down. A golden
// file instead asserts the entire output, so a change nobody anticipated — a
// rule firing one element earlier, an attribute appearing, a blank line
// disappearing — lands as a visible diff instead of a silent pass. The
// scenarios are the specification; this corpus is the net under it.
//
// The trap a corpus like this falls into is circularity: generated from the
// renderer, it can only assert that the output is what the output was, so a
// bug present at generation time is frozen as the specification. Two things
// answer that. It was generated after the conformance work that fixed the
// renderer's known divergences, and writing is deliberately hard: only
// `--update` writes, every run says what it wrote, and the diff is meant to be
// read in the PR rather than trusted.
//
// Line endings: the renderer emits `\n`, and this repository is checked out
// with CRLF on Windows (core.autocrlf is true and there is no .gitattributes),
// so the read side normalises `\r\n` before comparing and the write side
// always writes `\n`. The comparison is byte-for-byte on everything except the
// terminator, which belongs to the checkout rather than to the output.
//
// Run: node scripts/golden-check.ts            to compare (exits 1 on a diff)
//      node scripts/golden-check.ts --update   to regenerate after an
//                                              intended renderer change
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'out', 'golden-check.bundle.js');
const samplesDir = path.join(root, 'samples');
const goldenDir = path.join(samplesDir, 'golden');
const update = process.argv.includes('--update');

// The first line that differs, quoted from both sides. A failure that only
// says "differs" sends the reader to `diff` anyway; naming the line and
// showing it is the difference between a report and a hint.
function describeDifference(expected: string, actual: string): string {
  const golden = expected.split('\n');
  const rendered = actual.split('\n');
  for (let i = 0; i < Math.max(golden.length, rendered.length); i++) {
    if (golden[i] !== rendered[i]) {
      const show = (line: string | undefined): string => `"${(line ?? '<no line>').slice(0, 140)}"`;
      return [
        `      first difference at line ${i + 1}:`,
        `      golden: ${show(golden[i])}`,
        `      actual: ${show(rendered[i])}`,
      ].join('\n');
    }
  }
  return '';
}

async function main(): Promise<void> {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'markdown.ts')],
    bundle: true,
    outfile: bundle,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });

  // The bundle path is computed, so there is nothing for the compiler to
  // resolve; the cast names the module its contents came from, which is how the
  // result type below stays the renderer's own rather than a copy of it.
  const { renderMarkdown } = require(bundle) as typeof import('../src/markdown');

  let failures = 0;
  const check = (name: string, cond: boolean, detail?: string): void => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) {
      failures++;
      if (detail) console.log(detail);
    }
  };

  const documents = fs
    .readdirSync(samplesDir)
    .filter((file: string) => file.endsWith('.md'))
    .sort();

  // A corpus that checked nothing would report success, so say so instead.
  check('samples/ has documents to pin', documents.length > 0);

  if (update) fs.mkdirSync(goldenDir, { recursive: true });

  for (const file of documents) {
    const name = file.replace(/\.md$/, '');
    const relative = `samples/golden/${name}.html`;
    const goldenPath = path.join(goldenDir, `${name}.html`);
    const html = renderMarkdown(fs.readFileSync(path.join(samplesDir, file), 'utf8')).html;

    if (update) {
      const before = fs.existsSync(goldenPath)
        ? fs.readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n')
        : null;
      fs.writeFileSync(goldenPath, html, 'utf8');
      console.log(`${before === html ? 'same ' : 'wrote'}  ${relative}`);
      continue;
    }

    if (!fs.existsSync(goldenPath)) {
      check(
        `${file} has a golden file`,
        false,
        `      run \`node scripts/golden-check.ts --update\` to write ${relative}, then review the diff`
      );
      continue;
    }

    const expected = fs.readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n');
    check(
      `${file} renders exactly as ${relative}`,
      expected === html,
      expected === html ? undefined : describeDifference(expected, html)
    );
  }

  // A golden whose document is gone. `--update` cannot repair one of these —
  // there is nothing left to render — so it is a failure in both modes, and
  // the detail names the only fix.
  if (fs.existsSync(goldenDir)) {
    for (const orphan of fs.readdirSync(goldenDir).filter((f: string) => f.endsWith('.html'))) {
      if (documents.includes(`${orphan.replace(/\.html$/, '')}.md`)) continue;
      check(
        `samples/golden/${orphan} has a document`,
        false,
        `      samples/${orphan.replace(/\.html$/, '')}.md does not exist — remove it with \`git rm\``
      );
    }
  }

  if (update) {
    console.log(`\n${documents.length} document(s) written. \`git diff\` is the review.`);
    process.exitCode = failures === 0 ? 0 : 1;
    return;
  }
  console.log(failures === 0 ? '\nThe corpus matches.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
