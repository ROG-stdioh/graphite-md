/**
 * A content-derived version for a file the webview loads.
 *
 * VS Code's webview will serve a cached copy of an asset across panel reopens,
 * so an updated `media/preview.js` can keep running last release's code — with
 * no error, to exactly the users who upgraded correctly. The way out is to put
 * something in the URL that changes when the bytes change, and the only thing
 * that always changes with the bytes is the bytes.
 *
 * This replaced a constant in the HTML template that had to be bumped by hand,
 * and that was forgotten twice — once per release that touched a media file.
 * A step that depends on someone remembering is not a mechanism; deriving the
 * value from the file removes the step.
 *
 * Deliberately free of `vscode`: it is `fs` and `crypto` over a path, so
 * scripts/media-version-check.ts can exercise it outside the editor.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Served when a media file cannot be read.
 *
 * A missing file already means a broken preview, and this must not turn that
 * into a thrown error: the HTML is built outside the try/catch that renders the
 * error page, so a throw here surfaces as a blank panel with nothing to read.
 * Any stable value does — there is no cache to go stale against a file that is
 * not being served.
 */
const UNREADABLE = '0';

/**
 * What was hashed last time, and the answer, so a rebuild is not re-read on
 * every keystroke — `renderIntoPanel` runs on every edit, and mermaid.min.js
 * alone is 3.2 MB.
 *
 * Keyed on mtime and size as well as the path, because memoising on the path
 * alone would put the bug back in the one place it is easiest to hit:
 * `npm run build` rewrites `media/preview.js`, and a panel reopened afterwards
 * still lives in the same extension host, so a path-keyed cache would go on
 * handing back the previous bundle's URL. Two writes inside one mtime tick
 * would have to also leave the length unchanged to slip through.
 *
 * The stat is what makes that safe, and it is cheap enough to do on every
 * render — which is the whole reason the version can be trusted to be current.
 */
interface Stamp {
  mtimeMs: number;
  size: number;
  version: string;
}

const stamps = new Map<string, Stamp>();

/**
 * A short digest of the file's contents, stable for given bytes.
 *
 * Truncated because this is a cache key, not a security boundary: the value
 * only has to tell one build of a file from the next, and 48 bits does that
 * with room to spare while keeping the URLs readable in devtools.
 */
export function contentVersion(absPath: string): string {
  try {
    const stat = fs.statSync(absPath);
    const known = stamps.get(absPath);
    if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.version;

    const version = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 12);
    stamps.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, version });
    return version;
  } catch {
    // Includes a read that fails after a successful stat — a file deleted
    // mid-render, a permissions change. One file's version is not worth the
    // panel.
    return UNREADABLE;
  }
}
