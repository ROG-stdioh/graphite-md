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
import { profiling, mark, span, report } from '../shared/perf';
import { oneLine } from '../logger';

// First statement in the bundle, and deliberately so. In the webview the
// `performance` clock starts at navigation, so this reading is how long the page
// took to parse its HTML and the two scripts ahead of ours — mermaid.min.js
// among them. That is most of what opening the preview costs, and nothing later
// in this file can recover it.
mark('page → script');

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
    if (visible.length === 0) {
      // Rows exist and none of them laid out. Two things produce that, and only
      // one of them is legitimate: the graph sits inside a collapsed accordion
      // section, where the container is hidden as well and an empty svg is
      // exactly right; or the rows are not in the container at all, which is
      // what a reference to a previous build's rows looks like once the
      // container has been rebuilt under it. The second draws a blank outline
      // and says nothing — a preview that is simply empty, with no error
      // anywhere to explain it. The container's own visibility is what tells
      // them apart: a displayed container whose rows are all invisible can only
      // mean the rows are somewhere else.
      if (rows.length > 0 && container.offsetParent !== null) {
        logToHost('warn', `the outline has ${rows.length} rows and laid out none of them`);
      }
      return;
    }

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

// ================= webview state =================
// The one thing that survives the page being rebuilt. Every edit to the source
// file re-sends webview.html (see extension.ts), which reloads this page — and
// whatever the reader had arranged for themselves is gone with it unless it was
// stashed here. Webview state outlives setHtml; only closing the panel loses it.
//
// It is one object rather than one value, because `setState` replaces what is
// there rather than merging into it: two features writing their own field
// independently would each erase the other's.
const restored = readState(vscode.getState());
const persistedScrollTop = restored.scrollTop;

/**
 * The ids of the section bodies the reader has folded away.
 *
 * Collapse is a class on the element, so it is exactly as durable as the element
 * is — and a re-render replaces every element. Without this, every keystroke
 * sprang open every section the reader had closed, which is the kind of thing
 * that reads as the preview fighting back rather than as a missing feature.
 *
 * Held as ids rather than as element references for the same reason: the
 * elements do not survive, and an id can be looked up again once they exist.
 */
const collapsedBodies = new Set<string>(restored.collapsed);

function persistState(): void {
  vscode.setState({ scrollTop: contentPane.scrollTop, collapsed: [...collapsedBodies] });
}

/**
 * What the last page left behind.
 *
 * `getState()` is typed `unknown`, and it is right to be: the value comes back
 * from the host, and this file is the only thing that ever put anything in it.
 * Reading the two fields out is a check, not an assertion.
 */
function readState(raw: unknown): { scrollTop: number | null; collapsed: string[] } {
  if (typeof raw !== 'object' || raw === null) return { scrollTop: null, collapsed: [] };
  const { scrollTop, collapsed } = raw as { scrollTop?: unknown; collapsed?: unknown };
  return {
    scrollTop: typeof scrollTop === 'number' ? scrollTop : null,
    collapsed: Array.isArray(collapsed) ? collapsed.filter((id): id is string => typeof id === 'string') : [],
  };
}

const doneGraphs = span('buildGraph ×3');
const contentGraph = buildGraph(byId('graphContent'), previewData.headings);
const tablesGraph = buildGraph(byId('graphTables'), previewData.tables);
const diagramsGraph = buildGraph(byId('graphDiagrams'), previewData.diagrams);
doneGraphs();

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
// Delegated to the document rather than bound to each heading, because the
// headings do not outlive a re-render — a page reload replaces every one of them
// and the listeners bound to them go with it, leaving headings that look
// clickable and are not. The three other click handlers in this file are already
// on the document for the same reason; this was the last one holding a
// reference to an element that goes away.
//
// A missing target is checked rather than asserted here, unlike the per-element
// version it replaces. Bound to a heading, `data-target` was the renderer's own
// markup and `must` was the right shape for it; delegated, this handler sees
// whatever was clicked, and the losing case should be this handler doing nothing
// rather than an exception thrown at the document.
document.addEventListener('click', (e) => {
  const head = closestOf(e.target, '.section-head');
  if (!head) return;
  const target = head.dataset.target;
  if (target === undefined) return;
  const body = document.getElementById(target);
  if (!body) return;
  setCollapsed(body, !body.classList.contains('collapsed'));
});

/**
 * Folds or unfolds one section, in the DOM alone.
 *
 * The chevron is part of it because it is the same piece of state drawn twice: a
 * folded section and its arrow have never been allowed to disagree. Both halves
 * are guarded rather than asserted, which is what the callers did between them
 * before — nothing in this file navigates by chevron, so a heading without one
 * should cost its arrow's animation and not the navigation.
 */
function applyCollapsed(body: Element, collapsed: boolean): void {
  body.classList.toggle('collapsed', collapsed);
  const head = document.querySelector<HTMLElement>(`[data-target="${body.id}"].section-head`);
  const chev = head?.querySelector<HTMLElement>('.chev');
  if (chev) chev.classList.toggle('collapsed', collapsed);
}

/**
 * Folds or unfolds one section, and remembers it.
 *
 * Every site that changes a section's collapse state goes through here — the
 * heading click, the walk up from a clicked anchor, the outline's own
 * navigation, and a footnote backref. All four have to agree about the
 * remembered set as well as the class now, which is what makes one function
 * cheaper than four copies that drift apart.
 */
function setCollapsed(body: Element, collapsed: boolean): void {
  applyCollapsed(body, collapsed);
  if (body.id === '') return;
  if (collapsed) collapsedBodies.add(body.id);
  else collapsedBodies.delete(body.id);
  persistState();
}

/**
 * Puts back what the reader had folded away.
 *
 * Driven by the remembered ids rather than by scanning the document. An id the
 * new render no longer produces is skipped rather than chased: a section the
 * document has deleted is gone, and one it has renamed comes back open. There is
 * no way to tell that a renamed section is the same section, so claiming
 * otherwise would be a guess wearing persistence's clothes.
 */
function restoreCollapsed(): void {
  for (const id of collapsedBodies) {
    const body = document.getElementById(id);
    if (body) applyCollapsed(body, true);
  }
}

function expandAncestors(headEl: HTMLElement): void {
  let node = headEl.closest('.section-body');
  while (node) {
    setCollapsed(node, false);
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
  if (body) setCollapsed(body, false);
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
    setCollapsed(body, false);
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
// Without this, toggling a checkbox or typing a keystroke snaps the preview back
// to the top. Where it is stashed, and why that store is one object rather than
// one value, is in the webview-state block at the top of this file.
let saveScrollScheduled = false;
let userScrolled = false;
contentPane.addEventListener('scroll', () => {
  if (!saveScrollScheduled) {
    saveScrollScheduled = true;
    requestAnimationFrame(() => {
      saveScrollScheduled = false;
      persistState();
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

/**
 * A message for the host's Output Channel.
 *
 * The webview's own console is invisible unless DevTools is open, so without
 * this a diagram that failed to draw is silent — and silence is
 * indistinguishable from "still working", which is the exact question the
 * channel is opened to answer.
 *
 * Bounded here and bounded again on the far side. The two are not redundant:
 * this one keeps the message this webview sends readable, and the host's holds
 * even if what arrives was not sent by this webview at all.
 */
function logToHost(level: 'info' | 'warn' | 'error', message: string): void {
  vscode.postMessage({ type: 'log', level, message: oneLine(message) });
}

/**
 * An error's message, without its stack.
 *
 * A stack is host-side business — it names this bundle's internal frames and
 * means nothing in a log the user reads — so it is dropped here rather than
 * carried across and stripped later.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object' || err === null) return '';
  try {
    return JSON.stringify(err);
  } catch {
    return '';
  }
}

// The profile is printed once, when both halves of the load have settled: the
// init frame and mermaid's own (asynchronous, and much slower) pass. Either can
// finish first, so neither can print on its own without reporting a half-empty
// list. Both flags are also what let a release build skip the report entirely —
// see the guard in reportWhenSettled.
let mermaidDone = false;
let initDone = false;

function reportWhenSettled(): void {
  if (!profiling) return;
  if (!mermaidDone || !initDone) return;
  report(
    `preview load · ${previewData.headings.length} headings, ${previewData.tables.length} tables, ${previewData.diagrams.length} diagrams`
  );
}

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
  // Times the whole async pass, not just the call: what a reader waits for is
  // the moment the diagrams are on screen, which is when this promise settles.
  const doneMermaid = span('mermaid.run');
  mermaid
    .run({ querySelector: '.mermaid' })
    .then(() => {
      doneMermaid();
      mermaidDone = true;
      if (!userScrolled && contentPane.scrollHeight !== heightBefore && persistedScrollTop !== null) {
        contentPane.scrollTop = persistedScrollTop;
      }
      reportWhenSettled();
    })
    .catch((err: unknown) => {
      doneMermaid();
      mermaidDone = true;
      logToHost('error', `failed to render mermaid diagrams: ${describeError(err)}`);
      reportWhenSettled();
    });
} else {
  // No mermaid on the page. Since the tag is emitted only for a document that
  // has a diagram, that is the ordinary state for most documents — but it is
  // also what a document *with* diagrams looks like when the file failed to
  // load, and the page cannot tell those apart from mermaid's absence alone. It
  // does know how many diagrams it was handed, which is the half that does.
  if (previewData.diagrams.length > 0) {
    logToHost('warn', `this document has ${previewData.diagrams.length} diagrams but mermaid did not load`);
  }
  mermaidDone = true;
}

// ================= init =================
requestAnimationFrame(() => {
  // Inside the frame, not around it: the span should measure the work this
  // block does, not the ~16 ms it spent waiting for the next frame.
  const doneInit = span('init');
  // Before the scroll is restored, and that ordering is the whole reason it is
  // here rather than beside the state it reads: folding a section shortens the
  // page, so a scroll position put back first would be clamped against a
  // document taller than the one the reader left — landing short of where they
  // were, and never recovering.
  restoreCollapsed();
  contentGraph.drawGraph();
  onScroll();
  if (persistedScrollTop !== null) contentPane.scrollTop = persistedScrollTop;
  doneInit();
  initDone = true;
  reportWhenSettled();
});
window.addEventListener('resize', () => requestAnimationFrame(() => {
  contentGraph.drawGraph();
  tablesGraph.drawGraph();
  diagramsGraph.drawGraph();
}));
