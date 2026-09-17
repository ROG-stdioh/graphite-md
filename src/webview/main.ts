/**
 * graphite.md's preview webview.
 *
 * Bundled by esbuild to media/preview.js and loaded by the HTML template in
 * src/extension.ts — the output path is unchanged, so the host needs to know
 * nothing about this file having moved. The host <-> webview message contract
 * lives in src/shared/protocol.ts, which both programs compile.
 *
 * It runs in a plain browser context: `window`, `document`,
 * `requestAnimationFrame`, `performance`, `getComputedStyle` and
 * `acquireVsCodeApi` are globals of the page it is loaded into (declared in
 * ./globals.d.ts). Nothing here reaches for node or the `vscode` module, and
 * the webview program has no types for either.
 */

import { isHostToWebview, isPreviewData } from '../shared/protocol';
import type { PreviewData, TocNode } from '../shared/protocol';

const vscode = acquireVsCodeApi();

// The host injects this as a JSON literal; from here it is a value that arrived
// from outside, so it is narrowed rather than trusted. A node missing its label
// deep in the tree would otherwise surface as a TypeError part-way through
// building the outline, leaving a half-drawn graph and no clue why.
const rawPreviewData: unknown = window.__PREVIEW_DATA__;
const previewData: PreviewData = isPreviewData(rawPreviewData)
  ? rawPreviewData
  : { headings: [], tables: [], diagrams: [] };

/**
 * Fails loudly on an element the host's own template guarantees.
 *
 * This is the difference between a loud failure and a half-dead preview: the
 * host's HTML either contains #contentPane or the preview is not the page this
 * file was written for, and returning quietly from every lookup that missed
 * would turn that into a scrollbar that never appears and a message that is
 * never sent. The lookups that are genuinely optional — a query the document's
 * own content decides the answer to — are guarded at their call sites instead.
 */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`graphite.md: the preview is missing ${what}`);
  }
  return value;
}

function byId(id: string): HTMLElement {
  return must(document.getElementById(id), `#${id}`);
}

/**
 * `closest`, on an event target that may not be an element.
 *
 * Tested structurally rather than with `instanceof Element`, for two reasons
 * that both bite. The check scripts drive this file against a hand-rolled DOM
 * double whose elements are plain objects, so an instanceof test would be false
 * for every one of them and would turn three click assertions into silent
 * no-ops. And `Element` does not exist as a binding in Node at all, so under
 * those same check scripts the test would throw a ReferenceError rather than
 * merely answer false.
 *
 * The parameter is EventTarget, which carries no `closest` at all — so the
 * access is checked structurally first rather than asserted.
 *
 * The return type is HTMLElement, not the Element closest() is usually thought
 * to give back: lib.dom declares an `closest<E extends Element = Element>`
 * overload for a plain string selector, so the caller says what it matched. It
 * needs to, because every selector passed here names markup carrying data
 * attributes, and `dataset` lives on HTMLElement rather than Element.
 */
function closestOf(target: EventTarget | null, selector: string): HTMLElement | null {
  const el = target as Element | null;
  if (typeof el?.closest !== 'function') return null;
  return el.closest(selector);
}

// ================= generic graph builder (always fully expanded — no per-node collapse) =================
const svgNS = 'http://www.w3.org/2000/svg';
const TRUNK_X = 14; // x of depth-0 dots and the trunk line
const STEP_X = 20; // horizontal offset per nesting level

function dotX(depth: number): number {
  return TRUNK_X + depth * STEP_X;
}

interface TocRow {
  el: HTMLElement;
  dot: HTMLElement;
  target: string;
  depth: number;
  parent: TocRow | null;
}

interface Graph {
  rows: TocRow[];
  drawGraph: () => void;
  setActive: (id: string | null) => void;
}

function buildGraph(container: HTMLElement, data: TocNode[]): Graph {
  const svg = document.createElementNS(svgNS, 'svg');
  container.appendChild(svg);
  const rows: TocRow[] = [];

  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'Nothing here yet.';
    container.appendChild(empty);
  }

  // rows are built recursively so the outline can nest to any depth
  // (H2 -> H6 in one chain means depth 4); each row keeps a ref to its
  // parent row, which drawGraph uses to lay out the branch edges
  function addRow(node: TocNode, depth: number, parent: TocRow | null): void {
    const row = document.createElement('div');
    row.className = depth === 0 ? 'toc-row depth-0' : 'toc-row';
    row.style.paddingLeft = `${dotX(depth) + 18}px`;
    row.dataset.target = node.target;

    const dot = document.createElement('div');
    dot.className = 'toc-dot';
    dot.style.left = `${dotX(depth)}px`;
    row.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.label;
    label.title = node.label; // full text on hover when ellipsis truncates it
    row.appendChild(label);

    container.appendChild(row);
    const rec: TocRow = { el: row, dot, target: node.target, depth, parent };
    rows.push(rec);
    (node.children ?? []).forEach((child) => {
      addRow(child, depth + 1, rec);
    });
  }

  data.forEach((node) => {
    addRow(node, 0, null);
  });

  rows.forEach((r) => {
    r.dot.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo(r.target);
    });
    const label = must(r.el.querySelector<HTMLElement>('.label'), 'a row label');
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo(r.target);
    });
  });

  function rowCenterY(rowEl: HTMLElement): number {
    return rowEl.offsetTop + rowEl.offsetHeight / 2;
  }

  function drawGraph(): void {
    const visible = rows.filter((r) => r.el.offsetParent !== null);
    svg.innerHTML = '';
    if (visible.length === 0) return;

    const totalH = container.scrollHeight;
    const maxDepth = visible.reduce((max, r) => Math.max(max, r.depth), 0);
    svg.setAttribute('width', `${dotX(maxDepth) + 12}`);
    svg.setAttribute('height', `${totalH}`);

    // trunk: vertical line joining consecutive depth-0 rows
    const trunkRows = visible.filter((r) => r.depth === 0);
    let prevTrunk: TocRow | undefined;
    for (const row of trunkRows) {
      if (prevTrunk) {
        addLine(TRUNK_X, rowCenterY(prevTrunk.el), TRUNK_X, rowCenterY(row.el), 'border-strong', 2);
      }
      prevTrunk = row;
    }

    // branch edges: a row's first child curves out of its parent; later
    // siblings hang off a vertical line that starts at the first sibling.
    // Anything else (a sibling following a deeper subtree) curves out of
    // the parent again.
    visible.forEach((r, idx) => {
      if (r.depth === 0 || !r.parent) return;
      const prev = visible[idx - 1];
      const px = dotX(r.parent.depth), py = rowCenterY(r.parent.el);
      const x = dotX(r.depth), y = rowCenterY(r.el);
      if (prev && prev.depth === r.depth && prev.parent === r.parent) {
        addLine(x, rowCenterY(prev.el), x, y, 'border-strong', 2);
      } else {
        const midY = (py + y) / 2;
        addPath(`M${px},${py} C${px},${midY} ${x},${midY} ${x},${y}`, 'border-strong', 2);
      }
    });

    // active highlighting: accent line down the trunk, then the full
    // ancestor chain of the active row (each segment drawn the same way
    // its base edge was, including the sibling run for later children)
    const activeRow = visible.find((r) => r.el.classList.contains('active'));
    const firstTrunk = trunkRows[0];
    if (activeRow && firstTrunk) {
      // walk up to the root; the chain is never empty, but indexing it is not
      // something the compiler can see, so it is read once and checked
      const chain: TocRow[] = [];
      for (let cur: TocRow | undefined = activeRow; cur; cur = cur.parent ?? undefined) {
        chain.unshift(cur);
      }
      const chainTop = chain[0];
      if (chainTop) {
        const trunkTop = rowCenterY(firstTrunk.el);
        const chainTopY = rowCenterY(chainTop.el);
        if (chainTopY > trunkTop) {
          addLine(TRUNK_X, trunkTop, TRUNK_X, chainTopY, 'accent', 2, 0.9);
        }
      }

      let parent: TocRow | undefined;
      for (const child of chain) {
        if (parent) {
          const px = dotX(parent.depth), py = rowCenterY(parent.el);
          const cx = dotX(child.depth), cy = rowCenterY(child.el);
          const sibIdx = visible.indexOf(child);
          const prev = sibIdx > 0 ? visible[sibIdx - 1] : undefined;
          if (prev && prev.depth === child.depth && prev.parent === parent) {
            // later sibling: accent runs from the first sibling down to this one
            let firstSib = child;
            for (let j = sibIdx - 1; j >= 0; j--) {
              const candidate = visible[j];
              if (!candidate || candidate.depth !== child.depth || candidate.parent !== parent) break;
              firstSib = candidate;
            }
            const fy = rowCenterY(firstSib.el);
            const midY = (py + fy) / 2;
            addPath(`M${px},${py} C${px},${midY} ${cx},${midY} ${cx},${fy}`, 'accent', 2, 0.9);
            if (firstSib !== child) addLine(cx, fy, cx, cy, 'accent', 2, 0.9);
          } else {
            const midY = (py + cy) / 2;
            addPath(`M${px},${py} C${px},${midY} ${cx},${midY} ${cx},${cy}`, 'accent', 2, 0.9);
          }
        }
        parent = child;
      }
    }
  }

  function addLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    colorVar: string,
    width: number,
    opacity?: number
  ): void {
    const l = document.createElementNS(svgNS, 'line');
    l.setAttribute('x1', `${x1}`);
    l.setAttribute('y1', `${y1}`);
    l.setAttribute('x2', `${x2}`);
    l.setAttribute('y2', `${y2}`);
    l.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue(`--${colorVar}`));
    l.setAttribute('stroke-width', `${width}`);
    l.setAttribute('opacity', `${opacity === undefined ? 1 : opacity}`);
    svg.appendChild(l);
  }

  function addPath(d: string, colorVar: string, width: number, opacity?: number): void {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue(`--${colorVar}`));
    p.setAttribute('stroke-width', `${width}`);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('opacity', `${opacity === undefined ? 1 : opacity}`);
    svg.appendChild(p);
  }

  function setActive(id: string | null): void {
    rows.forEach((r) => r.el.classList.toggle('active', r.target === id));
    drawGraph();
  }

  drawGraph();
  return { rows, drawGraph, setActive };
}

const contentPane = byId('contentPane');

const contentGraph = buildGraph(byId('graphContent'), previewData.headings);
const tablesGraph = buildGraph(byId('graphTables'), previewData.tables);
const diagramsGraph = buildGraph(byId('graphDiagrams'), previewData.diagrams);

type ViewName = 'content' | 'tables' | 'diagrams';

interface Section {
  graph: Graph;
  header: HTMLElement;
  body: HTMLElement;
}

const sectionMap: Record<ViewName, Section> = {
  content: {
    graph: contentGraph,
    header: must(
      document.querySelector<HTMLElement>('.accordion-header[data-view="content"]'),
      'the Content accordion header'
    ),
    body: byId('graphContent'),
  },
  tables: {
    graph: tablesGraph,
    header: must(
      document.querySelector<HTMLElement>('.accordion-header[data-view="tables"]'),
      'the Tables accordion header'
    ),
    body: byId('graphTables'),
  },
  diagrams: {
    graph: diagramsGraph,
    header: must(
      document.querySelector<HTMLElement>('.accordion-header[data-view="diagrams"]'),
      'the Diagrams accordion header'
    ),
    body: byId('graphDiagrams'),
  },
};

/** A `data-view` attribute is a string from the DOM, so it is checked before it is used as a key. */
function mustViewName(value: string | undefined): ViewName {
  if (value === undefined || !Object.hasOwn(sectionMap, value)) {
    throw new Error(`graphite.md: the preview markup names an unknown outline view (${String(value)})`);
  }
  return value as ViewName;
}

function findRow(id: string): { section: Section; row: TocRow } | null {
  for (const section of Object.values(sectionMap)) {
    const row = section.graph.rows.find((candidate) => candidate.target === id);
    if (row) return { section, row };
  }
  return null;
}

// ================= accordion: at most one section expanded =================
function collapseAllSections(): void {
  Object.values(sectionMap).forEach((section) => {
    section.header.classList.remove('expanded');
    section.body.classList.add('collapsed');
  });
}

function expandSection(section: Section): void {
  collapseAllSections();
  section.header.classList.add('expanded');
  section.body.classList.remove('collapsed');
  requestAnimationFrame(() => {
    section.graph.drawGraph();
  });
}

document.querySelectorAll<HTMLElement>('.accordion-header').forEach((header) => {
  header.addEventListener('click', () => {
    const view = mustViewName(header.dataset.view);
    if (header.classList.contains('expanded')) {
      collapseAllSections();
    } else {
      expandSection(sectionMap[view]);
    }
  });
});

// ================= collapsible content sections (prose collapse — separate
//                    from the TOC graph, which is never collapsible itself) =================
document.querySelectorAll<HTMLElement>('.section-head').forEach((head) => {
  head.addEventListener('click', () => {
    const body = byId(must(head.dataset.target, 'a section heading target'));
    const chev = must(head.querySelector<HTMLElement>('.chev'), 'a section disclosure arrow');
    body.classList.toggle('collapsed');
    chev.classList.toggle('collapsed');
  });
});

/**
 * Uncovers a section heading's disclosure arrow, if it has one.
 *
 * Guarded rather than asserted, which is what the two callers below already did
 * between them. Nothing in this file navigates by chevron, so a heading without
 * one should lose nothing but its arrow's animation — not take the navigation
 * down with it.
 */
function uncoverChevron(head: HTMLElement | null): void {
  const chev = head?.querySelector<HTMLElement>('.chev');
  if (chev) chev.classList.remove('collapsed');
}

function expandAncestors(headEl: HTMLElement): void {
  let node = headEl.closest('.section-body');
  while (node) {
    node.classList.remove('collapsed');
    uncoverChevron(document.querySelector<HTMLElement>(`[data-target="${node.id}"].section-head`));
    node = node.parentElement?.closest('.section-body') ?? null;
  }
}

// ================= soft (eased) scroll-to, with a lock so scroll-spy
//                    can't fight the click mid-animation =================
let navLock = false;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateScrollTo(el: HTMLElement, target: number, duration: number, onDone: () => void): void {
  const start = el.scrollTop;
  const change = target - start;
  if (Math.abs(change) < 1) {
    onDone();
    return;
  }
  const startTime = performance.now();
  const step = (now: number): void => {
    const elapsed = Math.min((now - startTime) / duration, 1);
    el.scrollTop = start + change * easeInOutCubic(elapsed);
    if (elapsed < 1) requestAnimationFrame(step);
    else onDone();
  };
  requestAnimationFrame(step);
}

function pulseDot(id: string): void {
  const found = findRow(id);
  if (!found) return;
  const { dot } = found.row;
  dot.classList.remove('pulse');
  // Reading a layout property forces the browser to recompute style, so the
  // class going back on below restarts the animation instead of being coalesced
  // into "already pulsing". Deleting the read kills the pulse, and nothing else
  // in this repo covers that animation.
  //
  // The rule is right that `void` does nothing at the language level — the read
  // is the effect, and `void` is only here to mark the discarded value as
  // intended, since a bare `dot.offsetWidth;` is a no-unused-expressions error
  // instead. Rewriting a behaviour-critical line to satisfy a linter is the one
  // fix this file should not take.
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- forced reflow; the read is the effect, see above
  void dot.offsetWidth;
  dot.classList.add('pulse');
}

function navigateTo(id: string): void {
  const body = document.getElementById(id);
  const head = document.querySelector<HTMLElement>(`[data-target="${id}"].section-head`);
  if (body) {
    body.classList.remove('collapsed');
    uncoverChevron(head);
  }
  if (head) expandAncestors(head);

  const found = findRow(id);
  if (found) {
    if (found.section.body.classList.contains('collapsed')) {
      expandSection(found.section);
    }
    found.section.graph.setActive(id);
  }

  const target = head ?? body;
  navLock = true;
  if (target) {
    const targetTop =
      contentPane.scrollTop +
      target.getBoundingClientRect().top -
      contentPane.getBoundingClientRect().top -
      24;
    animateScrollTo(contentPane, targetTop, 520, () => {
      navLock = false;
      if (found) found.section.graph.setActive(id);
    });
  } else {
    navLock = false;
  }
  pulseDot(id);
}

// ================= custom overlay scrollbars =================
function attachScrollbar(wrap: HTMLElement): void {
  const body = must(wrap.querySelector<HTMLElement>('.scroll-body'), 'a .scroll-body inside a scroll wrap');
  const thumb = must(wrap.querySelector<HTMLElement>('.scroll-thumb'), 'a .scroll-thumb inside a scroll wrap');
  const track = must(wrap.querySelector<HTMLElement>('.scroll-track'), 'a .scroll-track inside a scroll wrap');
  let hideTimer: number | undefined;

  function sync(): void {
    const trackH = track.clientHeight;
    const ratio = body.clientHeight / body.scrollHeight;
    if (ratio >= 1) {
      thumb.style.opacity = '0';
      thumb.style.pointerEvents = 'none';
      return;
    }
    thumb.style.pointerEvents = 'auto';
    const thumbH = Math.max(ratio * trackH, 24);
    const maxThumbTop = trackH - thumbH;
    const scrollRatio = body.scrollTop / (body.scrollHeight - body.clientHeight);
    thumb.style.height = `${thumbH}px`;
    thumb.style.top = `${scrollRatio * maxThumbTop}px`;
  }

  function showThenFade(): void {
    wrap.classList.add('scrolling');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
    wrap.classList.remove('scrolling');
  }, 700);
  }

  body.addEventListener('scroll', () => {
    sync();
    showThenFade();
  }, { passive: true });
  window.addEventListener('resize', sync);

  let dragging = false, dragStartY = 0, dragStartScroll = 0;
  thumb.addEventListener('mousedown', (e) => {
    dragging = true;
    thumb.classList.add('dragging');
    dragStartY = e.clientY;
    dragStartScroll = body.scrollTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const trackH = track.clientHeight;
    const scrollRange = body.scrollHeight - body.clientHeight;
    const deltaY = e.clientY - dragStartY;
    body.scrollTop = dragStartScroll + (deltaY / trackH) * scrollRange;
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      thumb.classList.remove('dragging');
    }
  });
  sync();
}
document.querySelectorAll<HTMLElement>('.scroll-wrap').forEach((wrap) => {
  attachScrollbar(wrap);
});

// ================= scroll-spy (content headings only, suppressed while navLock is true) =================
const headings = Array.from(document.querySelectorAll<HTMLElement>('.section-head'));

function onScroll(): void {
  if (navLock) return;
  const first = headings[0];
  let currentId: string | null = first ? first.dataset.target ?? null : null;
  const paneTop = contentPane.getBoundingClientRect().top;
  for (const h of headings) {
    const r = h.getBoundingClientRect();
    if (r.top - paneTop < 80) currentId = h.dataset.target ?? null;
  }
  contentGraph.setActive(currentId);
}
contentPane.addEventListener('scroll', onScroll);

// ================= reading width — live sync if settings.json is edited
//                    directly while the preview is open (no in-panel UI) =================
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isHostToWebview(message)) return;
  // A switch rather than an `if`, for the same reason the host's handler is
  // one: switch-exhaustiveness-check fails the build when a variant is added to
  // HostToWebview and not handled here. With a single variant that costs one
  // always-true condition, which is what the rule below is objecting to — it is
  // correct, and the check is kept anyway because it is the thing that will
  // catch the second variant.
  switch (message.type) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- HostToWebview has one variant today; the switch is what makes adding a second a compile error
    case 'contentWidth':
      document.body.style.setProperty('--content-width', `${message.value}%`);
      return;
  }
});

// ================= checklist checkboxes — click writes back to the source file =================
document.addEventListener('click', (e) => {
  const box = closestOf(e.target, '.task-checkbox');
  if (!box) return;
  const line = box.dataset.line;
  if (line === undefined) return;
  const nowChecked = !box.classList.contains('checked');
  box.classList.toggle('checked', nowChecked); // optimistic — avoids a flicker before the doc-edit round-trips
  vscode.postMessage({ type: 'toggleTask', line: Number(line), checked: nowChecked });
});

// ================= in-page anchor links (footnotes etc.) =================
// VS Code webviews don't run native fragment navigation when a link is
// clicked, and the page scrolls in inner .scroll-body containers rather
// than the document anyway — so #hash links (footnote refs [^1] -> #fn1
// and footnote backrefs ↩︎ -> #fnref1, plus any other anchor whose target
// exists) get the same JS-driven soft scroll the outline uses.
document.addEventListener('click', (e) => {
  const a = closestOf(e.target, 'a[href^="#"]');
  if (!a) return;
  const href = must(a.getAttribute('href'), 'an anchor href');
  const target = document.getElementById(href.slice(1));
  if (!target) return; // no matching element — leave the click alone
  e.preventDefault();

  // VS Code registers its own link handling on the window, which runs after
  // this listener — and does not check defaultPrevented, unlike its drag and
  // context-menu handlers. Left to bubble, an anchor gets scrolled twice: ours,
  // then its own instant scrollIntoView. Document is the last node before
  // window, so stopping here is what keeps the click ours.
  e.stopPropagation();

  // A heading anchor names the section's *head*, which sits beside its body
  // rather than inside it — so opening from the head alone would unfold the
  // parent section and leave the one actually pointed at shut. Redirect it to
  // the body it titles first, and both cases walk the same loop.
  const head = target.closest('.section-head');
  const own = head
    ? document.getElementById(must(head.getAttribute('data-target'), 'a section target'))
    : null;

  // the target may sit in a section the user collapsed (a footnote
  // backref points back into text that may have been folded away) — open
  // it, and any ancestor sections, first
  let body = (own ?? target).closest('.section-body');
  while (body) {
    body.classList.remove('collapsed');
    uncoverChevron(document.querySelector<HTMLElement>(`[data-target="${body.id}"].section-head`));
    body = body.parentElement?.closest('.section-body') ?? null;
  }

  const targetTop =
    contentPane.scrollTop +
    target.getBoundingClientRect().top -
    contentPane.getBoundingClientRect().top -
    24;
  navLock = true;
  animateScrollTo(contentPane, targetTop, 520, () => {
    navLock = false;
    onScroll(); // resync the outline highlight now that scrolling settled
  });
});

// ================= real links — the host decides where they go ==========
// A plain <a href="setup.md"> left to the webview is handed to VS Code as
// an external URL, and because ".md" is Moldova's TLD the browser opens
// https://setup.md/ — a stranger's website — instead of the file sitting
// next to the document. Same for any relative path. Nothing here decides
// the destination; the host resolves it against the document (see
// openLink in extension.ts) so the webview never needs to know the path.
document.addEventListener('click', (e) => {
  const a = closestOf(e.target, 'a[href]');
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  if (!href || href.startsWith('#')) return; // in-page anchors handled above
  e.preventDefault();

  // The other half of the anchor handler's note above, and the reason an
  // external link opened two tabs: VS Code's own window-level handler posts
  // `did-click-link` for any <a> with an href and never checks
  // defaultPrevented, so the workbench opened the URL alongside this message.
  // Both routes are the host's to route, and only one of them knows where a
  // relative path should land — so the event stops here.
  e.stopPropagation();
  vscode.postMessage({ type: 'openLink', href });
});

// ================= halftone dot grid — computed from real pixel size, never stretched =================
function buildHalftone(el: Element): void {
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w === 0 || h === 0) return;

  const cell = 8;
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const colStep = w / cols;
  const rowStep = h / rows;
  const maxR = colStep * 0.66;
  const minR = 0.35;

  let svg = el.querySelector('.halftone-svg');
  if (!svg) {
    svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'halftone-svg');
    el.insertBefore(svg, el.firstChild);
  }
  svg.innerHTML = '';
  svg.setAttribute('width', `${w}`);
  svg.setAttribute('height', `${h}`);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const dotColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-code').trim();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const frac = cols > 1 ? c / (cols - 1) : 0;
      const eased = Math.pow(frac, 1.4);
      const rad = maxR * (1 - eased) + minR * eased;
      const cx = c * colStep + colStep / 2;
      const cy = r * rowStep + rowStep / 2;
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', `${cx}`);
      circle.setAttribute('cy', `${cy}`);
      circle.setAttribute('r', `${rad}`);
      circle.setAttribute('fill', dotColor);
      svg.appendChild(circle);
    }
  }
}

const callouts = Array.from(document.querySelectorAll('.callout'));
callouts.forEach((el) => {
  buildHalftone(el);
});

// The feature test is the point, and lib.dom cannot express it: ResizeObserver
// is typed as always present because it is, in the web platform this program
// compiles against. It is not present in older VS Code webviews, which is what
// the else branch is for — `--fix` deletes the check and the halftone dots stop
// resizing to their container with nothing else to show for it.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- feature test for older webviews; lib.dom types it as always present
if (window.ResizeObserver) {
  const ro = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      buildHalftone(entry.target);
    });
  });
  callouts.forEach((el) => {
    ro.observe(el);
  });
} else {
  window.addEventListener('resize', () => {
    callouts.forEach((el) => {
      buildHalftone(el);
    });
  });
}

// ================= scroll position survives re-renders =================
// Every edit to the source file re-sends webview.html (see extension.ts),
// which reloads this page — without this, toggling a checkbox or typing a
// keystroke snaps the preview back to the top. Webview state persists
// across setHtml calls (only a panel close loses it), so we stash the
// scroll position there and restore it on load.
const persistedScrollTop = readScrollTop(vscode.getState());

/**
 * `getState()` is typed `unknown`, and it is right to be: the value comes back
 * from the host, and this file is the only thing that ever put anything in it.
 * Reading a number out of it is a check, not an assertion.
 */
function readScrollTop(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { scrollTop } = raw as { scrollTop?: unknown };
  return typeof scrollTop === 'number' ? scrollTop : null;
}

let saveScrollScheduled = false;
let userScrolled = false;
contentPane.addEventListener('scroll', () => {
  if (!saveScrollScheduled) {
    saveScrollScheduled = true;
    requestAnimationFrame(() => {
      saveScrollScheduled = false;
      vscode.setState({ scrollTop: contentPane.scrollTop });
    });
  }
}, { passive: true });
contentPane.addEventListener('wheel', () => {
  userScrolled = true;
}, { passive: true });

// ================= mermaid =================
// startOnLoad is off because we render the diagrams ourselves, so we can
// re-apply the restored scroll position once the diagrams change the
// page height (mermaid replaces each .mermaid's content asynchronously)
const mermaid = window.mermaid;
if (mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      background: '#1C1B19',
      primaryColor: '#2A2926',
      primaryTextColor: '#F2EFE7',
      primaryBorderColor: '#E0785A',
      lineColor: '#837F76',
      secondaryColor: '#201F1D',
      tertiaryColor: '#201F1D',
      fontFamily: '-apple-system, Segoe UI, Inter, sans-serif',
    },
  });
  const heightBefore = contentPane.scrollHeight;
  mermaid
    .run({ querySelector: '.mermaid' })
    .then(() => {
      if (!userScrolled && contentPane.scrollHeight !== heightBefore && persistedScrollTop !== null) {
        contentPane.scrollTop = persistedScrollTop;
      }
    })
    .catch((err: unknown) => {
      console.error('graphite.md: failed to render mermaid diagrams', err);
    });
}

// ================= init =================
requestAnimationFrame(() => {
  contentGraph.drawGraph();
  onScroll();
  if (persistedScrollTop !== null) contentPane.scrollTop = persistedScrollTop;
});
window.addEventListener('resize', () => requestAnimationFrame(() => {
  contentGraph.drawGraph();
  tablesGraph.drawGraph();
  diagramsGraph.drawGraph();
}));
