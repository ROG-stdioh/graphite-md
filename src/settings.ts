/**
 * Reading the extension's settings defensively.
 *
 * `getConfiguration().get<number>(key, fallback)` is an assertion, not a check.
 * The type parameter says what the caller hopes is there, and VS Code hands
 * back whatever settings.json actually holds — so a hand-edited
 * `"contentWidth": "80"` arrives as a string wearing a number's type, and every
 * later use of it is a lie the compiler believes. Reading `.get<number>()` and
 * trusting it is exactly the failure this release exists to stop making.
 *
 * Deliberately free of any `vscode` import. extension.ts cannot be required
 * outside a running VS Code, so anything left inside it is untestable until
 * there are integration tests; a pure function out here can be loaded and
 * exercised by the check scripts today.
 */

/** Mirrors the `graphiteMd.contentWidth` contribution in package.json. */
export const CONTENT_WIDTH_MIN = 40;

/**
 * The top of the same range.
 *
 * `@public` is load-bearing. knip follows ESM imports and does not follow the
 * `require()` calls this repo's tooling is built on — eslint.config.ts records
 * why they are requires — so the one consumer it could see for this, the clamp
 * assertion in scripts/graph-check.ts, is invisible to it. CONTENT_WIDTH_MIN
 * above escapes that blindness only by luck: src/extension.ts happens to import
 * it as well. The tag is knip's own escape hatch for an export it cannot trace,
 * and it is narrower than the alternatives — a file-wide exemption would stop
 * reporting a genuinely dead export from this module.
 */
export const CONTENT_WIDTH_MAX = 100;

/**
 * Coerces whatever settings.json holds into a width the preview can use.
 *
 * Anything that is not a finite number — a boolean, an object, a truncated
 * string like "80px", a missing setting — falls back. A number outside the
 * contributed range is clamped to it, because an out-of-range value does not
 * fail loudly: the browser drops the invalid `--content-width` declaration and
 * the reading column silently reverts to the stylesheet's own default.
 *
 * An empty or whitespace-only string is treated as unset rather than as zero,
 * which is what `Number('')` would otherwise make of it.
 */
export function resolveContentWidth(raw: unknown, fallback: number): number {
  const width = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw;
  if (typeof width !== 'number' || !Number.isFinite(width)) return fallback;
  return Math.min(CONTENT_WIDTH_MAX, Math.max(CONTENT_WIDTH_MIN, width));
}
