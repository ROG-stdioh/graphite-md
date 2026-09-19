/**
 * Dev-only timing instrumentation, shared by the extension host and the webview.
 *
 * Both programs compile this file, so it reaches for nothing but `performance`
 * and `console` — the two things Node and a browser context both have.
 *
 * **Everything here is inert in a release build.** `__PROFILE__` is substituted
 * textually by esbuild (`define` in esbuild.ts), so the shipped bundles carry
 * `if (false)` at every entry point below and the minifier drops the bodies.
 * scripts/package-check.ts greps the packaged preview.js for the marker,
 * because "the minifier should have removed it" is a belief and a grep is a
 * fact.
 *
 * **This is a developer's tool, not a product feature.** Nothing here is wired
 * to the Output Channel. That channel is user-facing — it is what a user reads
 * when the preview misbehaves — and shipping profiler plumbing to someone who
 * never asked for it would be exactly the "unnecessary stuff" this file exists
 * to find.
 */

// esbuild replaces this identifier textually. Declared module-locally rather
// than ambient in a .d.ts, so it cannot leak into either program's globals.
declare const __PROFILE__: boolean;

/** Whether the build that produced this bundle kept its instrumentation. */
export const profiling: boolean = __PROFILE__;

interface Sample {
  label: string;
  /** `performance.now()` when the sample was taken. */
  at: number;
  /** Milliseconds since the previous sample, or this span's own duration. Null on the first `mark`. */
  since: number | null;
}

const samples: Sample[] = [];
let last: number | null = null;
let startedAt: number | null = null;

function record(label: string, at: number, since: number | null): void {
  startedAt ??= at;
  last = at;
  samples.push({ label, at, since });
}

/**
 * Records the moment `label` happened.
 *
 * The first mark is the one worth reading: it prints as an absolute clock
 * value, and in the webview that clock starts at navigation — so
 * `mark('page → script')` at the top of main.ts reports how long the page took
 * to parse the HTML and the two scripts ahead of ours, which is most of the
 * cold-open cost.
 */
export function mark(label: string): void {
  if (!__PROFILE__) return;
  const now = performance.now();
  record(label, now, last === null ? null : now - last);
}

/**
 * Times the work between this call and the function it returns.
 *
 * `const done = span('mermaid.run'); …; done();`
 */
export function span(label: string): () => void {
  if (!__PROFILE__) return () => {};
  const start = performance.now();
  startedAt ??= start;
  return () => {
    const now = performance.now();
    record(label, now, now - start);
  };
}

/** Last path segment of a URL, so a vscode-webview:// origin does not fill the line. */
function shortName(url: string): string {
  const cut = url.lastIndexOf('/');
  return cut === -1 ? url : url.slice(cut + 1);
}

/**
 * What the page actually fetched, and how long each took.
 *
 * This is the half of the question a headless measurement cannot answer: whether
 * the four media files are re-fetched on every reload, or served from the
 * webview's cache. `duration` is the whole entry, so a cache hit shows up as
 * near-zero rather than as an absence.
 */
function resourceLines(): string[] {
  const out: string[] = [];
  for (const entry of performance.getEntriesByType('resource')) {
    // `PerformanceEntry` is all either program can see: `PerformanceResourceTiming`
    // is a DOM-only type and the host program has no DOM lib. `transferSize` is
    // read structurally for the same reason.
    const size = (entry as { transferSize?: unknown }).transferSize;
    const kb = typeof size === 'number' && size > 0 ? ` ${(size / 1024).toFixed(1)} kB` : '';
    out.push(`    ${shortName(entry.name).padEnd(26)} ${entry.duration.toFixed(1)} ms${kb}`);
  }
  return out;
}

/**
 * Prints everything collected so far. Call once, at the end of the run.
 *
 * `title` carries whatever context the caller has that this file cannot know —
 * the document name, its size, whether this was a cold open or a reload.
 */
export function report(title: string): void {
  if (!__PROFILE__) return;
  const elapsed = startedAt === null ? 0 : performance.now() - startedAt;

  const lines = [`[graphite.md profile] ${title}`];
  for (const s of samples) {
    // A first `mark` has no predecessor to be measured against, so it prints
    // its own clock reading — which is the measurement, not a fallback.
    const value = s.since === null ? `${s.at.toFixed(1)} ms (abs)` : `${s.since.toFixed(1)} ms`;
    lines.push(`    ${s.label.padEnd(26)} ${value}`);
  }
  lines.push(`    ${'elapsed'.padEnd(26)} ${elapsed.toFixed(1)} ms`);

  const resources = resourceLines();
  if (resources.length) {
    lines.push(`    resources (${resources.length}):`);
    lines.push(...resources);
  }

  console.log(lines.join('\n'));
}
