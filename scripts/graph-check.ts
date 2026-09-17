// Runs media/preview.js against a tiny DOM double to verify the graph builder
// lays out edges correctly at arbitrary depth, and — the larger half — the
// messages the webview exchanges with the host. Run:
//   node scripts/graph-check.ts
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

// media/preview.js is generated and gitignored, so it is rebuilt here before
// anything reads it — through the same options object the real build uses, so
// the bytes under test are the bytes that ship. Without this the checks would
// silently run against whatever the last build happened to leave on disk.
//
// esbuild.ts sets its exports with `module.exports`, which the compiler cannot
// read a module's shape from, so the one value needed here is named explicitly.
const { buildWebview } = require('../esbuild.ts') as { buildWebview: () => void };
buildWebview();

let failures = 0;
const check = (name: string, cond: boolean): void => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

type StubHandler = (event?: unknown) => void;

interface StubClassList {
  set: Set<string>;
  add(c: string): void;
  remove(c: string): void;
  toggle(c: string, on?: boolean): boolean;
  contains(c: string): boolean;
}

interface StubStyle {
  setProperty(key: string, value: string): void;
  // The two properties this harness reads back, declared as the webview writes
  // them (main.ts: `style.left = \`${dotX(depth)}px\``, `style.paddingLeft =
  // \`${dotX(depth) + 18}px\``). Without these the index signature below makes
  // every read `unknown`, and an assertion parsing one out has to either cast
  // or stringify a value the checker can only call an Object.
  left?: string;
  paddingLeft?: string;
  [key: string]: unknown;
}

/**
 * A DOM element as this double models it.
 *
 * Only as complete as the webview's code and these assertions need: the
 * double's job is to let a test *set* geometry, because jsdom implements no
 * layout engine and would return zero for every rect, making the graph
 * assertions vacuous. Members are typed for what is read, not for what the real
 * DOM has.
 *
 * `getAttribute` may return null, not just undefined, because the tests
 * override it to model an element that has no such attribute — a real one does
 * the same.
 */
interface StubEl {
  tag: string;
  id: string;
  children: StubEl[];
  attrs: Record<string, string>;
  style: StubStyle;
  className: string;
  dataset: Record<string, string>;
  textContent: string;
  title: string;
  innerHTML: string;
  _html?: string;
  offsetParent: unknown; // truthy == visible
  offsetTop: number;
  offsetHeight: number;
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
  _listeners: Record<string, StubHandler[]>;
  addEventListener(type: string, fn: StubHandler): void;
  appendChild<T extends StubEl>(c: T): T;
  insertBefore<T extends StubEl>(c: T): T;
  setAttribute(key: string, value: unknown): void;
  getAttribute(key: string): string | null | undefined;
  querySelector(sel: string): StubEl | null;
  querySelectorAll(sel: string): StubEl[];
  classList: StubClassList;
  getBoundingClientRect(): { top: number };
  closest(sel: string): StubEl | null;
}

function makeEl(tag: string): StubEl {
  return {
    tag,
    id: '',
    children: [],
    attrs: {},
    // setProperty records onto the object itself, so `style.getPropertyValue`
    // style reads and plain `style.height = ...` assignments both work — the
    // code under test uses both forms.
    style: { setProperty(k: string, v: string) { this[k] = v; } },
    className: '',
    dataset: {},
    textContent: '',
    title: '',
    get innerHTML(): string { return this._html ?? ''; },
    set innerHTML(v: string) { this._html = v; if (v === '') this.children = []; },
    offsetParent: {}, // visible
    offsetTop: 0,
    offsetHeight: 32,
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
    // Listeners are recorded rather than dropped. Nothing fires them
    // implicitly — tests reach them via the element's _listeners — but a
    // no-op here would make the accordion, the scrollbar drag and the
    // scroll-position save untestable while still looking registered.
    _listeners: {},
    addEventListener(type: string, fn: StubHandler) {
      (this._listeners[type] ??= []).push(fn);
    },
    appendChild<T extends StubEl>(c: T): T { this.children.push(c); return c; },
    insertBefore<T extends StubEl>(c: T): T { this.children.unshift(c); return c; },
    setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); },
    getAttribute(k: string): string | undefined { return this.attrs[k]; },
    querySelector(sel: string): StubEl | null {
      return this.children.find((c) => c.className && c.className.split(' ').includes(sel.slice(1))) ?? null;
    },
    querySelectorAll(): StubEl[] { return []; },
    classList: {
      set: new Set<string>(),
      add(c: string) { this.set.add(c); },
      remove(c: string) { this.set.delete(c); },
      toggle(c: string, on?: boolean): boolean {
        const next = on ?? !this.set.has(c);
        if (next) this.set.add(c); else this.set.delete(c);
        return next;
      },
      contains(c: string) { return this.set.has(c); },
    },
    getBoundingClientRect(): { top: number } { return { top: 0 }; },
    closest(): StubEl | null { return null; },
  };
}

// the tree under test: A -> B -> C -> D -> E ; A -> F ; G
const tree = [
  { label: 'A', target: 'a', children: [
    { label: 'B', target: 'b', children: [
      { label: 'C', target: 'c', children: [
        { label: 'D', target: 'd', children: [
          { label: 'E', target: 'e' },
        ] },
      ] },
    ] },
    { label: 'F', target: 'f' },
  ] },
  { label: 'G', target: 'g' },
];

/** One entry of the outline the double hands the webview. */
interface StubTocNode {
  label: string;
  target: string;
  children?: StubTocNode[];
}

/** The ids `run` always creates, so the tests can reach them without a lookup
 *  that `noUncheckedIndexedAccess` would make nullable. */
type StubId = 'graphContent' | 'graphTables' | 'graphDiagrams' | 'contentPane' | 'contentInner';
const STUB_IDS: readonly StubId[] = ['graphContent', 'graphTables', 'graphDiagrams', 'contentPane', 'contentInner'];

/** A single drawn SVG child, reduced to the attributes the assertions read. */
interface DrawnEdge {
  line: { x1: string; y1: string; x2: string; y2: string } | null;
  path: string | null;
  stroke: string | undefined;
  opacity: string | undefined;
}

interface Harness {
  rows: StubEl[];
  svg: StubEl;
  drawn: DrawnEdge[];
  document: { body: StubEl };
  handlers: Record<string, StubHandler[]>;
  // The five ids `run` always creates, named so a test can reach them directly.
  // The index signature stays for the ids a test adds itself (`fnref1`).
  byId: Record<string, StubEl> & Record<StubId, StubEl>;
  flushAll(): void;
  posted: Record<string, unknown>[];
  state: Record<string, unknown>;
  winHandlers: Record<string, StubHandler[]>;
  accordionByView: Record<string, StubEl>;
}

// builds fresh stubs, runs preview.js, lays out rows, and returns the
// built rows + svg after the init rAF has flushed. `spyTarget` is the
// .section-head the scroll-spy reports, i.e. which row ends up active.
function run(spyTarget: string, opts: { state?: Record<string, unknown> } = {}): Harness {
  // Populated from STUB_IDS below, so the cast states what the loop
  // guarantees: every id in that list is present by the time this returns.
  const byId = {} as Record<string, StubEl> & Record<StubId, StubEl>;
  for (const id of STUB_IDS) {
    const el = makeEl('div');
    el.id = id;
    byId[id] = el;
  }
  const docEl = makeEl('html');
  const bodyEl = makeEl('body');

  // The accordion headers sectionMap looks up. querySelector returned null for
  // every selector before, so sectionMap held three nulls and any call into
  // collapseAllSections threw on `s.header.classList` — which is why the
  // accordion was not merely unasserted but unreachable.
  const accordionHeaders = ['content', 'tables', 'diagrams'].map((view) => {
    const h = makeEl('div');
    h.className = 'accordion-header';
    h.dataset.view = view;
    return h;
  });
  const accordionByView: Record<string, StubEl> = {};
  accordionHeaders.forEach((h) => { accordionByView[h.dataset.view ?? ''] = h; });

  const handlers: Record<string, StubHandler[]> = {};
  const document = {
    documentElement: docEl,
    body: bodyEl,
    createElement: (tag: string) => makeEl(tag),
    createElementNS: (_ns: string, tag: string) => makeEl(tag),
    getElementById: (id: string) => byId[id],
    querySelector: (sel: string) => {
      const m = /^\.accordion-header\[data-view="(\w+)"\]$/.exec(sel);
      return m ? (accordionByView[m[1] ?? ''] ?? null) : null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '.accordion-header') return accordionHeaders;
      if (sel.includes('.section-head') && spyTarget) {
        return [{ dataset: { target: spyTarget }, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {} }];
      }
      return [];
    },
    addEventListener(type: string, fn: StubHandler) { (handlers[type] ??= []).push(fn); },
  };
  const rafQueue: (() => void)[] = [];
  const winHandlers: Record<string, StubHandler[]> = {};
  const window = {
    addEventListener(type: string, fn: StubHandler) { (winHandlers[type] ??= []).push(fn); },
    ResizeObserver: undefined as unknown,
    mermaid: undefined as unknown,
    __PREVIEW_DATA__: { headings: tree, tables: [], diagrams: [] } as {
      headings: StubTocNode[];
      tables: StubTocNode[];
      diagrams: StubTocNode[];
    },
  };
  // like a real browser, rAF callbacks receive a high-res timestamp
  let clock = 0;
  const performance = { now: () => (clock += 120) };
  const requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.push(() => { cb(performance.now()); }); };
  // Both directions are recorded. `postMessage(){}` and `getState: () => ({})`
  // were no-ops, so the entire host contract and the scroll restore were
  // unassertable while appearing to be wired up.
  const posted: Record<string, unknown>[] = [];
  const state: Record<string, unknown> = Object.assign({}, opts.state ?? {});
  const acquireVsCodeApi = () => ({
    getState: () => state,
    setState: (s: Record<string, unknown>) => Object.assign(state, s),
    postMessage: (m: Record<string, unknown>) => posted.push(m),
  });
  const getComputedStyle = () => ({ getPropertyValue: (v: string) => (v === '--border-strong' ? '#000' : v === '--accent' ? '#f00' : '') });

  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'preview.js'), 'utf8');
  // `new Function` is the point, not an oversight: the bundle under test is an
  // iife built for the browser that reads window, document and the VS Code API
  // as free identifiers, so the only way to run it here is to compile it with
  // those names as parameters. Nothing about the source reaches this call from
  // outside the repo — it is the file esbuild just built from src/webview.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const fn = new Function('window', 'document', 'requestAnimationFrame', 'performance', 'acquireVsCodeApi', 'getComputedStyle', src) as (
    window: unknown,
    document: unknown,
    requestAnimationFrame: unknown,
    performance: unknown,
    acquireVsCodeApi: unknown,
    getComputedStyle: unknown
  ) => void;
  fn(window, document, requestAnimationFrame, performance, acquireVsCodeApi, getComputedStyle);

  const graph = byId.graphContent;
  const rows = graph.children.filter((c) => c.className && c.className.includes('toc-row'));
  rows.forEach((r, i) => { r.offsetTop = i * 32; r.offsetHeight = 32; });
  graph.scrollHeight = rows.length * 32;
  rafQueue.splice(0).forEach((cb) => { cb(); }); // init rAF: drawGraph + onScroll

  const svg = graph.children.find((c) => c.tag === 'svg');
  if (!svg) throw new Error('the webview drew no <svg> for the outline');
  const drawn = svg.children.map((e): DrawnEdge => ({
    line: e.tag === 'line'
      ? { x1: e.attrs.x1 ?? '', y1: e.attrs.y1 ?? '', x2: e.attrs.x2 ?? '', y2: e.attrs.y2 ?? '' }
      : null,
    path: e.tag === 'path' ? (e.attrs.d ?? null) : null,
    stroke: e.attrs.stroke,
    opacity: e.attrs.opacity,
  }));
  const flushAll = () => {
    for (let i = 0; i < 40 && rafQueue.length; i++) {
      rafQueue.splice(0).forEach((cb) => { cb(); });
    }
  };
  return { rows, svg, drawn, document, handlers, byId, flushAll, posted, state, winHandlers, accordionByView };
}

const rowLabel = (r: StubEl): string => r.children.find((c) => c.className === 'label')?.textContent ?? '';
const dotLeft = (r: StubEl): number => parseInt(r.children.find((c) => c.className === 'toc-dot')?.style.left ?? '0', 10);

// ---- structure ----
const base = run('');
const { rows, svg, drawn } = base;
check('7 rows built (A,B,C,D,E,F,G)', rows.length === 7);
check('labels in document order', rows.map(rowLabel).join('') === 'ABCDEFG');
check('depths -> dot x (14,34,54,74,94)', rows.map(dotLeft).join(',') === '14,34,54,74,94,34,14');
check('depth-0 rows have depth-0 class', rows.filter((r) => r.className.includes('depth-0')).length === 2);
check('row indent = dot x + 18', rows.every((r) => parseInt(r.style.paddingLeft ?? '', 10) === dotLeft(r) + 18));

// ---- base edges (rows are 32px -> centers at 16,48,80,112,144,176,208) ----
check('1 trunk line (A->G)', drawn.filter((e) => e.line && e.stroke === '#000').length === 1);
check('5 branch edges (B,C,D,E,F)', drawn.filter((e) => e.path && e.stroke === '#000').length === 5);
check('no accent strokes without an active row', drawn.filter((e) => e.stroke === '#f00').length === 0);
check('B curve from A', drawn.some((e) => e.path === 'M14,16 C14,32 34,32 34,48' && e.stroke === '#000'));
check('E curve from D at x=74->94', drawn.some((e) => e.path === 'M74,112 C74,128 94,128 94,144' && e.stroke === '#000'));
check('F re-curves from A (after deep subtree)', drawn.some((e) => e.path === 'M14,16 C14,96 34,96 34,176' && e.stroke === '#000'));
check('svg width covers deepest level', parseInt(svg.attrs.width ?? '0', 10) >= 106);

// ---- accents, driven the way the real app does it (scroll-spy) ----
const b = run('b');
const accentsB = b.drawn.filter((e) => e.stroke === '#f00');
check('active B -> 1 accent segment (A->B)', accentsB.length === 1 && accentsB[0]?.path === 'M14,16 C14,32 34,32 34,48');

const f = run('f');
const accentsF = f.drawn.filter((e) => e.stroke === '#f00');
check('active F -> accent curve from A (matches base edge)', accentsF.length === 1 && accentsF[0]?.path === 'M14,16 C14,96 34,96 34,176');

const c = run('c');
const accentsC = c.drawn.filter((e) => e.stroke === '#f00');
check('active C -> 2 accent segments (A->B, B->C)',
  accentsC.length === 2
  && accentsC.some((e) => e.path === 'M14,16 C14,32 34,32 34,48')
  && accentsC.some((e) => e.path === 'M34,48 C34,64 54,64 54,80'));

// ---- in-page anchor clicks (footnote backref) ----
const sim = run('');
const pane = sim.byId.contentPane;

function makeAnchor(href: string): StubEl {
  const a = makeEl('a');
  a.getAttribute = (k: string) => (k === 'href' ? href : null);
  a.closest = (sel: string) => (sel === 'a[href^="#"]' ? a : null);
  return a;
}

interface ClickEvent {
  target: StubEl;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

// A real click bubbles target -> … -> document -> window, and the webview is not
// the only listener: VS Code registers its own link handling on the content
// window, where it runs after this file's document handlers and — unlike its
// drag and context-menu handlers — never checks defaultPrevented. It posts
// `did-click-link` and the workbench opens the URI itself, so a handled click
// that still reached the window opened twice in the editor, and an anchor
// scrolled twice, with nothing here to catch it.
//
// The double runs the document's handlers and then the window's, skipping the
// window when one of them called stopPropagation. That is the whole mechanism
// the fix rests on, so a webview that stops doing it fails here.
//
// `?? []` because the double records listeners into a plain map: if the webview
// stopped registering a click handler this is empty and every assertion below
// fails, which is the outcome being tested for anyway.
function clickEvent(target: StubEl, harness: Harness): ClickEvent {
  const e: ClickEvent = {
    target,
    prevented: false,
    stopped: false,
    preventDefault() { e.prevented = true; },
    stopPropagation() { e.stopped = true; },
  };
  (harness.handlers.click ?? []).forEach((h) => { h(e); });
  if (!e.stopped) (harness.winHandlers.click ?? []).forEach((h) => { h(e); });
  harness.flushAll(); // run the scroll animation to completion
  return e;
}

// Stands in for VS Code's handler. Anything this sees, VS Code saw.
function watchWindow(harness: Harness): () => number {
  let seen = 0;
  // A fresh harness has no window listeners at all — this bundle registers none
  // — so the read may legitimately come back empty.
  const listeners = harness.winHandlers.click ?? [];
  listeners.push(() => { seen += 1; });
  harness.winHandlers.click = listeners;
  return () => seen;
}

const simWindow = watchWindow(sim);

function fireClick(anchor: StubEl): ClickEvent {
  return clickEvent(anchor, sim);
}

// backref: href="#fnref1" whose target sits 400px below the pane top
const backref = makeAnchor('#fnref1');
const fnTarget = makeEl('a');
fnTarget.closest = () => null; // not inside any collapsible section
fnTarget.getBoundingClientRect = () => ({ top: 400 });
sim.byId.fnref1 = fnTarget;
pane.scrollTop = 0;

const ev = fireClick(backref);
// expected: pane.scrollTop + target.top(400) - pane.top(0) - 24 = 376
check('backref click soft-scrolls to the target', Math.abs(pane.scrollTop - 376) < 1);
check('backref click is intercepted (preventDefault)', ev.prevented);
// and stopped before the window, where VS Code would scroll it a second time
check('a handled anchor click never reaches the window', simWindow() === 0);

// anchor with a target that does not exist -> left alone, no scrolling
const dead = makeAnchor('#nope');
pane.scrollTop = 123;
const ev2 = fireClick(dead);
check('dead anchor left alone (no preventDefault, no scroll)', !ev2.prevented && pane.scrollTop === 123);
// Leaving it alone has to mean leaving it alone all the way up: the webview
// only stops a click it actually handled, so the window still sees this one.
check('an unhandled anchor click is left to the window', simWindow() === 1);

// ---- a heading anchor into a collapsed section ----
// `[anchor link](#tables)` on a `## Tables` heading, which is the reported bug.
// A heading's element and its body are siblings, not parent and child, so
// getElementById hands back the heading — and unfolding from *that* would walk
// up to the enclosing section and leave the one being pointed at shut.
const anchorSim = run('');
const anchorWindow = watchWindow(anchorSim);
const anchorPane = anchorSim.byId.contentPane;

const sectionBody = makeEl('div');
sectionBody.className = 'section-body';
sectionBody.id = 'body-tables';
sectionBody.classList.add('collapsed');
sectionBody.getBoundingClientRect = () => ({ top: 250 });
sectionBody.closest = (sel: string) => (sel === '.section-body' ? sectionBody : null);

const sectionHead = makeEl('h2');
sectionHead.className = 'section-head';
sectionHead.setAttribute('data-target', 'body-tables');
sectionHead.closest = (sel: string) => (sel === '.section-head' ? sectionHead : null);
sectionHead.getBoundingClientRect = () => ({ top: 250 });

anchorSim.byId['tables'] = sectionHead;
anchorSim.byId['body-tables'] = sectionBody;
anchorPane.scrollTop = 0;

const headingEv = fireClickOn(anchorSim, makeAnchor('#tables'));
check('a heading anchor unfolds the section it names', !sectionBody.classList.contains('collapsed'));
// expected: scrollTop 0 + head.top 250 - pane.top 0 - 24 = 226
check('a heading anchor scrolls to the heading', Math.abs(anchorPane.scrollTop - 226) < 1);
check('a heading anchor click is intercepted', headingEv.prevented);
check('a handled heading anchor never reaches the window',
  anchorWindow() === 0 && headingEv.stopped);

// ==================== the host contract ====================
// Everything below is what the webview says *to the host*, or what the host
// says to it. None of it was covered before: postMessage was a no-op, so
// these messages were produced into nothing and never asserted.

function fireClickOn(target: Harness, el: StubEl): ClickEvent {
  return clickEvent(el, target);
}
// Guarded so a missing message reports FAIL instead of throwing and taking
// the rest of the run down with it.
function sendCheckbox(target: Harness, line: number | undefined, checked: boolean): StubEl {
  const box = makeEl('span');
  box.className = 'task-checkbox';
  if (line !== undefined) box.dataset.line = String(line);
  if (checked) box.classList.add('checked');
  box.closest = (sel: string) => (sel === '.task-checkbox' ? box : null);
  fireClickOn(target, box);
  return box;
}

// ---- checklist click -> toggleTask ----
const cl = run('');
const msg = (i: number): Record<string, unknown> => cl.posted[i] ?? {};
const box = sendCheckbox(cl, 12, false);
check('checking a box posts toggleTask', msg(0).type === 'toggleTask' && msg(0).line === 12 && msg(0).checked === true);
check('toggleTask line is a number, not the dataset string', typeof msg(0).line === 'number');
check('checking a box flips it optimistically', box.classList.contains('checked'));
check('exactly one message per click', cl.posted.length === 1);

// A fresh element each call, so the assertion has to read from this one —
// the box from the first click is a different object with its own classList.
const box2 = sendCheckbox(cl, 12, true);
check('unchecking posts checked:false', msg(1).type === 'toggleTask' && msg(1).checked === false);
check('unchecking clears the optimistic class', !box2.classList.contains('checked'));
const before = cl.posted.length;
sendCheckbox(cl, undefined, false);
check('a checkbox with no source line posts nothing', cl.posted.length === before);

// ---- link click -> openLink ----
function makeLink(href: string): StubEl {
  const a = makeEl('a');
  a.closest = (sel: string) => (sel === 'a[href]' ? a : null);
  a.getAttribute = (k: string) => (k === 'href' ? href : null);
  return a;
}
const lk = run('');
const lkWindow = watchWindow(lk);
const linkEv = fireClickOn(lk, makeLink('setup.md'));
// Destructured once so the two clauses below are checks on the same value
// rather than two index reads the checker has to relate to each other.
const [linkMsg] = lk.posted;
check('a relative link is handed to the host',
  lk.posted.length === 1 && linkMsg?.type === 'openLink' && linkMsg.href === 'setup.md');
check('a relative link click is intercepted', linkEv.prevented);
// The bug this replaced: VS Code opened the URI from its own handler at the
// same time as the host did, so one click on an external link opened two tabs.
check('a handled link click never reaches the window', lkWindow() === 0);

const lk2 = run('');
fireClickOn(lk2, makeLink('#fnref1'));
check('an in-page anchor is not sent to the host', lk2.posted.length === 0);

const lk3 = run('');
fireClickOn(lk3, makeLink(''));
check('an empty href posts nothing', lk3.posted.length === 0);

// ---- accordion: at most one section open ----
const ac = run('');
function clickAccordion(target: Harness, view: string): void {
  (target.accordionByView[view]?._listeners.click ?? []).forEach((fn) => { fn(); });
  target.flushAll();
}
clickAccordion(ac, 'content');
check('clicking a section header opens it',
  ac.accordionByView.content?.classList.contains('expanded') === true
  && !ac.byId.graphContent.classList.contains('collapsed'));
check('opening a section closes the others',
  ac.byId.graphTables.classList.contains('collapsed')
  && ac.byId.graphDiagrams.classList.contains('collapsed')
  && ac.accordionByView.tables?.classList.contains('expanded') === false);

clickAccordion(ac, 'diagrams');
check('opening another section closes the first (at most one open)',
  ac.accordionByView.diagrams?.classList.contains('expanded') === true
  && !ac.byId.graphDiagrams.classList.contains('collapsed')
  && ac.accordionByView.content?.classList.contains('expanded') === false
  && ac.byId.graphContent.classList.contains('collapsed'));

clickAccordion(ac, 'diagrams');
check('clicking the open section closes it',
  ac.accordionByView.diagrams?.classList.contains('expanded') === false
  && ac.byId.graphDiagrams.classList.contains('collapsed'));

// ---- contentWidth message -> CSS variable ----
const cw = run('');
(cw.winHandlers.message ?? []).forEach((h) => { h({ data: { type: 'contentWidth', value: 80 } }); });
check('contentWidth sets the reading-width variable', cw.document.body.style['--content-width'] === '80%');
(cw.winHandlers.message ?? []).forEach((h) => { h({ data: { type: 'somethingElse' } }); });
check('an unrelated message leaves the width alone', cw.document.body.style['--content-width'] === '80%');

// ---- the host's defence against a hand-edited setting ----
// extension.ts cannot be required outside a running VS Code, so the coercion it
// uses lives in src/settings.ts and is exercised here rather than not at all.
// The bug it exists for: getConfiguration().get<number>() is an assertion, not a
// check, so "contentWidth": "80" in settings.json arrives as a string wearing a
// number's type and the rest of the extension believes it.
//
// src/settings.ts and src/shared/protocol.ts below use real `export` syntax, so
// unlike esbuild.ts their module shape is something the compiler can read.
const { resolveContentWidth, CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX } =
  require('../src/settings.ts') as typeof import('../src/settings');

const FALLBACK = 60;
check('a real number passes through', resolveContentWidth(80, FALLBACK) === 80);
check('a numeric string is coerced, not rejected', resolveContentWidth('80', FALLBACK) === 80);
check('a missing setting falls back', resolveContentWidth(undefined, FALLBACK) === FALLBACK);
check('an empty string is unset, not zero', resolveContentWidth('', FALLBACK) === FALLBACK);
check('a truncated value like "80px" falls back', resolveContentWidth('80px', FALLBACK) === FALLBACK);
check('a boolean falls back', resolveContentWidth(true, FALLBACK) === FALLBACK);
check('an object falls back', resolveContentWidth({ width: 80 }, FALLBACK) === FALLBACK);
check('NaN falls back', resolveContentWidth(Number.NaN, FALLBACK) === FALLBACK);
check('Infinity falls back', resolveContentWidth(Number.POSITIVE_INFINITY, FALLBACK) === FALLBACK);
check('a value below the contributed range clamps up',
  resolveContentWidth(5, FALLBACK) === CONTENT_WIDTH_MIN);
check('a value above the contributed range clamps down',
  resolveContentWidth(500, FALLBACK) === CONTENT_WIDTH_MAX);

// ---- scroll position survives a re-render ----
const s1 = run('');
s1.byId.contentPane.scrollTop = 250;
(s1.byId.contentPane._listeners.scroll ?? []).forEach((fn) => { fn(); });
s1.flushAll(); // the save is deferred to a rAF
check('scrolling stashes the position in webview state', s1.state.scrollTop === 250);

const s2 = run('', { state: { scrollTop: 250 } });
check('a re-render restores the stashed scroll position', s2.byId.contentPane.scrollTop === 250);

const s3 = run('', { state: {} });
check('a re-render with no stash starts at the top', s3.byId.contentPane.scrollTop === 0);

// ---- the host's guard must accept what this webview actually sends ----
// The host runs isWebviewToHost() over every message before acting on it. If
// the guard and the webview ever disagree, the webview posts, the host drops it
// on the floor and returns, and none of the assertions above notice — they
// inspect cl.posted and lk.posted directly, which is the webview's side of the
// wire only. So the guard is run against the real recorded payloads rather than
// against examples written here to match it.
//
// protocol.ts is TypeScript and required directly. Node strips the types; it is
// why the check scripts need Node 24, which is also what CI pins.
const { isWebviewToHost } = require('../src/shared/protocol.ts') as typeof import('../src/shared/protocol');

const sent = [...cl.posted, ...lk.posted];
check('the webview posted messages to check', sent.length > 0);
check('every message the webview sends passes the host guard', sent.every((m) => isWebviewToHost(m)));

// A guard that says yes to everything would pass the check above, so it has to
// be shown saying no.
check('the host guard rejects a toggleTask with no checked flag',
  !isWebviewToHost({ type: 'toggleTask', line: 5 }));
check('the host guard rejects a toggleTask with a string line',
  !isWebviewToHost({ type: 'toggleTask', line: '5', checked: true }));
check('the host guard rejects an unknown type', !isWebviewToHost({ type: 'nope' }));
check('the host guard rejects a bare string', !isWebviewToHost('toggleTask'));
check('the host guard rejects null', !isWebviewToHost(null));

console.log(failures === 0 ? '\nAll graph checks passed.' : `\n${failures} graph check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
