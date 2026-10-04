// Runs media/preview.js against a tiny DOM double to verify the graph builder
// lays out edges correctly at arbitrary depth, and — the larger half — the
// messages the webview exchanges with the host. At the end it also builds the
// real page and checks the ids the webview looks up against it, which no test
// driven by a hand-made DOM can see. Run:
//   node scripts/graph-check.ts
//
// `require` rather than `import` keeps this file CommonJS, which is what lets
// Node run it directly; the cast reattaches the module type @types/node widens
// to `any`. See esbuild.ts for the full note.
const esbuild = require('esbuild') as typeof import('esbuild');
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
const check = (name: string, cond: boolean, detail?: string): void => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures++;
    if (detail !== undefined) console.log(`      ${detail}`);
  }
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
  // The properties this harness reads back, declared as the webview writes them
  // (main.ts: `style.left = \`${dotX(depth)}px\``, `style.paddingLeft =
  // \`${dotX(depth) + 18}px\``, and the scrollbar's `style.height`/`style.top`).
  // Without these the index signature below makes every read `unknown`, and an
  // assertion parsing one out has to either cast or stringify a value the
  // checker can only call an Object.
  left?: string;
  paddingLeft?: string;
  height?: string;
  top?: string;
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
  offsetParent: unknown; // truthy == visible — an accessor, see makeEl
  offsetTop: number;
  offsetHeight: number;
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
  _listeners: Record<string, StubHandler[]>;
  /** The element this one was appended to. Nothing else holds the tree
   *  together — the double walks it for `offsetParent`, below. */
  parentEl: StubEl | null;
  /** Set by assigning null to `offsetParent`: this element alone has no box,
   *  whatever its ancestors say. */
  _detached?: boolean;
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
  contains(node: StubEl | null): boolean;
  focus(): void;
}

/** Whether an element is display:none — folded away, or detached on purpose. */
function hasNoBox(el: StubEl): boolean {
  return el._detached === true || el.classList.contains('collapsed');
}

/**
 * The element that was last focused, which `document.activeElement` answers
 * with.
 *
 * Module-level because the elements are made by `makeEl` while the document
 * object is made by `run`, so there is no one place both can see. `run` clears
 * it, so no harness inherits the previous one's focus.
 */
let focusedEl: StubEl | null = null;

function makeEl(tag: string): StubEl {
  // Named, so the one member that needs the element's own identity can refer to
  // it: `focus()` records which element was focused. `this` would do the same
  // job, but the linter reads storing `this` in a variable as the class-era
  // pattern it is not, and a name is clearer at the one place it is needed.
  const el: StubEl = {
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
    // A real `offsetParent` is null for a `display:none` element and for
    // anything inside one, and `collapsed` is how this page hides an accordion
    // body. Modelled rather than assumed visible, because `drawGraph` reads
    // exactly that null to tell a graph inside a folded section — legitimately
    // empty — from a graph whose rows are somewhere else, which it reports. A
    // double that handed back a box for everything could not tell those apart
    // either, and the two accordion views the page starts folded would look
    // drawn while nothing had drawn them.
    get offsetParent(): unknown {
      if (hasNoBox(this)) return null;
      for (let ancestor = this.parentEl; ancestor; ancestor = ancestor.parentEl) {
        if (hasNoBox(ancestor)) return null;
      }
      return {};
    },
    set offsetParent(v: unknown) { this._detached = v === null; },
    parentEl: null,
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
    appendChild<T extends StubEl>(c: T): T { c.parentEl = this; this.children.push(c); return c; },
    insertBefore<T extends StubEl>(c: T): T { c.parentEl = this; this.children.unshift(c); return c; },
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
    // The real containment, over the tree the double builds from `parentEl` —
    // which is what `tocWrap.contains(document.activeElement)` asks when the
    // outline folds, and the answer decides whether focus has to be moved.
    contains(node: StubEl | null): boolean {
      for (let el = node; el; el = el.parentEl) {
        if (el === this) return true;
      }
      return false;
    },
    focus() { focusedEl = el; },
  };
  return el;
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

// The other two outline views. Flat, because that is the shape the renderer
// builds them in — a table or a diagram is a place in the document, not a
// heading with anything under it — and non-empty, because a graph built from an
// empty list draws nothing whether or not it works. Both of these were `[]`
// until now, so the Tables and Diagrams views were assembled from nothing:
// clicking either accordion header ran a draw that had nothing to draw, and a
// graph that drew no edges was indistinguishable from one that never drew.
const tablesTree: StubTocNode[] = [
  { label: 'Totals', target: 'table-1' },
  { label: 'Comparison', target: 'table-2' },
];
const diagramsTree: StubTocNode[] = [
  { label: 'Flow', target: 'diagram-1' },
  { label: 'Sequence', target: 'diagram-2' },
];

/** The ids `run` always creates, so the tests can reach them without a lookup
 *  that `noUncheckedIndexedAccess` would make nullable. */
type StubId =
  | 'graphContent'
  | 'graphTables'
  | 'graphDiagrams'
  | 'contentPane'
  | 'contentInner'
  | 'tocPaneWrap'
  | 'outlineToggle';
const STUB_IDS: readonly StubId[] = [
  'graphContent',
  'graphTables',
  'graphDiagrams',
  'contentPane',
  'contentInner',
  'tocPaneWrap',
  'outlineToggle',
];

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
  document: { body: StubEl; readonly activeElement: StubEl | null };
  handlers: Record<string, StubHandler[]>;
  // The five ids `run` always creates, named so a test can reach them directly.
  // The index signature stays for the ids a test adds itself (`fnref1`).
  byId: Record<string, StubEl> & Record<StubId, StubEl>;
  flushAll(): void;
  posted: Record<string, unknown>[];
  /** The store the host holds, as of right now — a getter, because a save
   *  replaces the object rather than writing into it. */
  readonly state: Record<string, unknown>;
  winHandlers: Record<string, StubHandler[]>;
  accordionByView: Record<string, StubEl>;
}

/** The rows a graph container holds. */
function rowsIn(container: StubEl): StubEl[] {
  return container.children.filter((c) => c.className.includes('toc-row'));
}

/** A graph container's svg, which buildGraph appends before anything else. */
function swapIn(container: StubEl): StubEl | undefined {
  return container.children.find((c) => c.tag === 'svg');
}

/** What a graph has actually drawn. Read when it is asked for rather than
 *  captured once, because only the Content graph is drawn at init — the other
 *  two are drawn when their accordion opens. */
function drawnIn(container: StubEl): DrawnEdge[] {
  return (swapIn(container)?.children ?? []).map((e): DrawnEdge => ({
    line: e.tag === 'line'
      ? { x1: e.attrs.x1 ?? '', y1: e.attrs.y1 ?? '', x2: e.attrs.x2 ?? '', y2: e.attrs.y2 ?? '' }
      : null,
    path: e.tag === 'path' ? (e.attrs.d ?? null) : null,
    stroke: e.attrs.stroke,
    opacity: e.attrs.opacity,
  }));
}

// builds fresh stubs, runs preview.js, lays out rows, and returns the
// built rows + svg after the init rAF has flushed. `spyTarget` is the
// .section-head the scroll-spy reports, i.e. which row ends up active.
function run(
  spyTarget: string,
  opts: {
    state?: Record<string, unknown>;
    mermaid?: unknown;
    /** Elements the document should already hold, by id — a section body the
     *  reader had folded, or one a click is about to fold. */
    elements?: Record<string, StubEl>;
    /** The `.section-head` carrying each `data-target`, so the selector the
     *  webview uses to find a section's chevron has something to find. */
    heads?: Record<string, StubEl>;
    /** Report no layout box for every row, which is what a stale reference to a
     *  previous build's rows looks like from inside drawGraph. */
    detachRows?: boolean;
    /** What each outline view is built from. Overridable so a test can hand one
     *  view an empty list on purpose — which is how a document with no diagrams
     *  is modelled, and it is not the same page as one whose diagrams are
     *  there. */
    tables?: StubTocNode[];
    diagrams?: StubTocNode[];
  } = {}
): Harness {
  // Populated from STUB_IDS below, so the cast states what the loop
  // guarantees: every id in that list is present by the time this returns.
  const byId = {} as Record<string, StubEl> & Record<StubId, StubEl>;
  // The classes the real markup carries, taken from webviewHtml.ts: all three
  // containers are `.graph`, and the two below Content start folded. The double
  // created them bare, so it modelled a page that does not exist — and since
  // `collapsed` is what hides a body, a view that starts folded looked identical
  // to one that had been opened.
  const containerClasses: Record<StubId, readonly string[]> = {
    graphContent: ['graph'],
    graphTables: ['graph', 'collapsed'],
    graphDiagrams: ['graph', 'collapsed'],
    contentPane: [],
    contentInner: [],
    tocPaneWrap: ['toc-pane-wrap', 'scroll-wrap'],
    outlineToggle: ['outline-toggle'],
  };
  for (const id of STUB_IDS) {
    const el = makeEl('div');
    el.id = id;
    containerClasses[id].forEach((cls) => { el.classList.add(cls); });
    byId[id] = el;
  }
  // Added before the bundle runs, not after, because the page looks its own
  // state up during the init frame: a section folded on the previous load has to
  // be findable by the time restoreCollapsed goes looking for it.
  for (const [id, el] of Object.entries(opts.elements ?? {})) {
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

  // The outline pane's real shape, which the double had no reason to model
  // until the fold gave it one. Three things hang off it that the tests below
  // depend on: the three graph containers, because `display:none` on an
  // ancestor takes the layout box from every row inside it — which is the
  // whole reason a resize while folded wipes the outline; the accordion
  // headers, which are the focusable things inside the pane and so the only
  // place the fold's focus handoff can be tested from; and the scrollbar parts,
  // because attachScrollbar needs a `.scroll-wrap` back from the selector and
  // the double answered that (and every other querySelectorAll) with `[]`, so
  // it had never run here at all.
  bodyEl.appendChild(byId.tocPaneWrap);
  byId.tocPaneWrap.appendChild(byId.graphContent);
  byId.tocPaneWrap.appendChild(byId.graphTables);
  byId.tocPaneWrap.appendChild(byId.graphDiagrams);
  accordionHeaders.forEach((h) => { byId.tocPaneWrap.appendChild(h); });
  for (const className of ['scroll-body', 'scroll-track', 'scroll-thumb']) {
    const el = makeEl('div');
    el.className = className;
    byId.tocPaneWrap.appendChild(el);
  }

  const handlers: Record<string, StubHandler[]> = {};
  // Cleared per run so a harness never starts life holding the previous one's
  // focus, which is what a module-level holder would otherwise hand it.
  focusedEl = null;
  const document = {
    documentElement: docEl,
    body: bodyEl,
    // A getter rather than a field: `focus()` is called on the element, by code
    // that has no reference to this object, so the value has to be read at the
    // moment it is asked for.
    get activeElement(): StubEl | null { return focusedEl; },
    createElement: (tag: string) => makeEl(tag),
    createElementNS: (_ns: string, tag: string) => makeEl(tag),
    getElementById: (id: string) => byId[id],
    querySelector: (sel: string) => {
      const m = /^\.accordion-header\[data-view="(\w+)"\]$/.exec(sel);
      if (m) return accordionByView[m[1] ?? ''] ?? null;
      // The one other selector this program looks anything up by. A section's
      // chevron is reached through it, so without this a fold would move the
      // body and leave the arrow pointing the wrong way, with nothing here to
      // catch it — the `undefined` from a missing map entry would be read as
      // "this heading has no chevron", which is the guard's legitimate case.
      const head = /^\[data-target="([^"]*)"\]\.section-head$/.exec(sel);
      return head ? (opts.heads?.[head[1] ?? ''] ?? null) : null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '.accordion-header') return accordionHeaders;
      // One, not two: the real page has a wrap per pane, and the content pane
      // has none of the three parts modelled here. The outline's is the wrap
      // this feature can hide, so it is the one worth building.
      if (sel === '.scroll-wrap') return [byId.tocPaneWrap];
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
    // Undefined for every run but the mermaid-failure one below, which is what
    // makes the `else { mermaidDone = true }` branch the covered path by
    // default and the failure branch an explicit case rather than a side effect
    // of the harness not having a mermaid.
    mermaid: opts.mermaid,
    __PREVIEW_DATA__: {
      headings: tree,
      tables: opts.tables ?? tablesTree,
      diagrams: opts.diagrams ?? diagramsTree,
    } as {
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
  // Assigned, not merged into: the host's `setState` replaces what it holds, so
  // a double that merged was more forgiving than the real thing. What that hid
  // is the failure worth catching — a `persistState()` that stopped writing a
  // field would leave the previous value sitting in the store and the feature
  // would appear to survive a re-render while never being saved at all, and no
  // test run against a merging double can tell those apart.
  let state: Record<string, unknown> = Object.assign({}, opts.state ?? {});
  const acquireVsCodeApi = () => ({
    // Reads the binding rather than a captured object, for the same reason.
    getState: () => state,
    setState: (s: Record<string, unknown>) => { state = s; },
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
  const rows = rowsIn(graph);
  // All three graphs, not just the one that draws at init: Tables and Diagrams
  // are drawn when their accordion opens, and a graph whose rows have no
  // geometry draws nothing — so leaving them unlaid-out would have made every
  // assertion about them pass for the wrong reason.
  for (const id of ['graphContent', 'graphTables', 'graphDiagrams'] as const) {
    const container = byId[id];
    const inGraph = rowsIn(container);
    inGraph.forEach((r, i) => { r.offsetTop = i * 32; r.offsetHeight = 32; });
    container.scrollHeight = inGraph.length * 32;
  }
  // Before the init frame, because that is when drawGraph reads it.
  if (opts.detachRows) rows.forEach((r) => { r.offsetParent = null; });
  rafQueue.splice(0).forEach((cb) => { cb(); }); // init rAF: drawGraph + onScroll

  const svg = swapIn(graph);
  if (!svg) throw new Error('the webview drew no <svg> for the outline');
  const drawn = drawnIn(graph);
  const flushAll = () => {
    for (let i = 0; i < 40 && rafQueue.length; i++) {
      rafQueue.splice(0).forEach((cb) => { cb(); });
    }
  };
  return {
    rows, svg, drawn, document, handlers, byId, flushAll, posted, winHandlers, accordionByView,
    // A getter, because `setState` replaces the stored object: a field holding
    // the first one would keep reporting the state the page started with.
    get state(): Record<string, unknown> { return state; },
  };
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

// Two ways of reading `posted`, and the reason both exist is that the page
// speaks before anything is clicked: the double hands the webview a document
// with diagrams and no mermaid — the vendored script failing to load — and the
// page warns about it while the script is still evaluating. So a count taken
// from zero would be counting that warning as if a click had caused it, and
// every block below would drift the moment the fixture changed.

/** The messages a click added, given the count taken before it. */
function postedSince(harness: Harness, before: number): Record<string, unknown>[] {
  return harness.posted.slice(before);
}

/** The page's own log messages, as text — the shape the host routes. */
function postedLogs(harness: Harness): { level: unknown; message: string }[] {
  const logs: { level: unknown; message: string }[] = [];
  for (const m of harness.posted) {
    if (m.type === 'log' && typeof m.message === 'string') logs.push({ level: m.level, message: m.message });
  }
  return logs;
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
// Taken before the click, so what the page said while loading is not counted
// as something the click said — see postedSince.
const clLoad = cl.posted.length;
const msg = (i: number): Record<string, unknown> => postedSince(cl, clLoad)[i] ?? {};
const box = sendCheckbox(cl, 12, false);
check('checking a box posts toggleTask', msg(0).type === 'toggleTask' && msg(0).line === 12 && msg(0).checked === true);
check('toggleTask line is a number, not the dataset string', typeof msg(0).line === 'number');
check('checking a box flips it optimistically', box.classList.contains('checked'));
check('exactly one message per click', postedSince(cl, clLoad).length === 1);

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
const lkLoad = lk.posted.length;
const lkWindow = watchWindow(lk);
const linkEv = fireClickOn(lk, makeLink('setup.md'));
// Destructured once so the two clauses below are checks on the same value
// rather than two index reads the checker has to relate to each other.
const [linkMsg] = postedSince(lk, lkLoad);
check('a relative link is handed to the host',
  postedSince(lk, lkLoad).length === 1 && linkMsg?.type === 'openLink' && linkMsg.href === 'setup.md');
check('a relative link click is intercepted', linkEv.prevented);
// The bug this replaced: VS Code opened the URI from its own handler at the
// same time as the host did, so one click on an external link opened two tabs.
check('a handled link click never reaches the window', lkWindow() === 0);

const lk2 = run('');
const lk2Load = lk2.posted.length;
fireClickOn(lk2, makeLink('#fnref1'));
check('an in-page anchor is not sent to the host', postedSince(lk2, lk2Load).length === 0);

const lk3 = run('');
const lk3Load = lk3.posted.length;
fireClickOn(lk3, makeLink(''));
check('an empty href posts nothing', postedSince(lk3, lk3Load).length === 0);

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

// ---- the other two views draw on demand, and are worth looking at ----
// Only the Content graph is drawn by the init frame; Tables and Diagrams are
// drawn from inside expandSection, so whether they show anything is decided by
// a click. Both were built from `[]` until the fixtures above, which meant a
// click on either header ran a draw over an empty container: a graph that drew
// nothing and one that never ran were indistinguishable, which is the one thing
// a test of them cannot be.
//
// Both trees are flat, so the only edge either graph can draw is the trunk line
// between its first two rows — at the trunk's x, from the first row's centre to
// the second's. Asserted as a shape rather than a count, so a graph that drew
// the right number of the wrong lines still fails. Row i is centred at
// i * 32 + 16; see the layout in run.
//
// Worth knowing before reading the first check: buildGraph draws its own graph
// once before returning, so both of these have already run a draw by the time a
// test holds them. What leaves the folded two empty is not that nothing drew —
// it is that their rows sit inside a `display:none` section and so have no
// layout box to be placed by. A draw that finds nothing to place, in a container
// that is itself hidden, is the state the page is in when the reader opens it.
const isFirstTrunkLine = (e: DrawnEdge): boolean =>
  e.line !== null && e.line.x1 === '14' && e.line.x2 === '14' && e.line.y1 === '16' && e.line.y2 === '48';

const tv = run('');
check('the Tables graph draws nothing while its section is folded',
  drawnIn(tv.byId.graphTables).length === 0);
clickAccordion(tv, 'tables');
check('opening the Tables section draws its graph',
  rowsIn(tv.byId.graphTables).length === tablesTree.length);
check('...as a trunk line from the first row to the second',
  drawnIn(tv.byId.graphTables).some(isFirstTrunkLine));

const dv = run('');
check('the Diagrams graph draws nothing while its section is folded',
  drawnIn(dv.byId.graphDiagrams).length === 0);
clickAccordion(dv, 'diagrams');
check('opening the Diagrams section draws its graph',
  rowsIn(dv.byId.graphDiagrams).length === diagramsTree.length);
check('...as a trunk line from the first row to the second',
  drawnIn(dv.byId.graphDiagrams).some(isFirstTrunkLine));

// The window resize handler redraws all three graphs, open or not — and the two
// folded ones are the case `drawGraph`'s own early return exists for: their rows
// have no layout box because they are inside a `display:none` section, which is
// not the same as rows that are missing, and only the container's visibility
// tells those apart. A graph that got this wrong would either draw an outline
// inside a folded section or report its own rows as lost, and both are visible
// from here.
const rz = run('');
const rzSvg = swapIn(rz.byId.graphContent);
if (!rzSvg) throw new Error('the webview drew no <svg> for the outline');
rzSvg.innerHTML = ''; // emptied, so only a redraw can fill it again
(rz.winHandlers.resize ?? []).forEach((h) => { h(); });
rz.flushAll();
check('a resize redraws the open graph', drawnIn(rz.byId.graphContent).length > 0);
check('...and draws nothing into the folded ones',
  drawnIn(rz.byId.graphTables).length === 0 && drawnIn(rz.byId.graphDiagrams).length === 0);
check('...without calling their folded rows lost',
  !postedLogs(rz).some((m) => m.message.includes('outline')));

// ---- folding the outline pane away ----
// The pane is a fixed-width flex item, and this control is what gives its width
// back to the reading column. Two halves have to stay in step — the class that
// hides it, and the announcement on the button that brings it back — and the
// state has to survive the re-render every keystroke triggers, because the
// whole page is rebuilt from scratch each time.
const ob = run('');
const togglePane = (h: Harness): void => {
  (h.byId.outlineToggle._listeners.click ?? []).forEach((fn) => { fn(); });
  h.flushAll();
};

check('the outline starts open', !ob.byId.tocPaneWrap.classList.contains('collapsed'));
check('...and its control says so', ob.byId.outlineToggle.getAttribute('aria-expanded') === 'true');
check('...announcing what a click will do', ob.byId.outlineToggle.getAttribute('aria-label') === 'Hide the outline');

togglePane(ob);
check('clicking the control folds the pane away', ob.byId.tocPaneWrap.classList.contains('collapsed'));
check('...and the announcement turns with it', ob.byId.outlineToggle.getAttribute('aria-expanded') === 'false');
check('...now naming the way back', ob.byId.outlineToggle.getAttribute('aria-label') === 'Show the outline');

// Through the store rather than through a hand-written object: the field the
// fold writes and the field the next page reads have to be the same one, and a
// harness handed its own state would agree with a persistState() that wrote
// nothing at all. The double's setState replaces what it holds, so a field that
// stopped being written comes back `undefined` rather than as its old value.
const ob2 = run('', { state: ob.state });
check('a re-render brings the folded pane back folded',
  ob2.byId.tocPaneWrap.classList.contains('collapsed')
  && ob2.byId.outlineToggle.getAttribute('aria-expanded') === 'false');

// Folding takes the pane out of the rendering, and an element inside a
// `display:none` subtree cannot hold focus — the browser moves it to the body,
// which drops a keyboard reader at the top of the document. The control that
// closed the pane is where they can carry on from.
const fo = run('');
const foContent = fo.accordionByView.content;
if (!foContent) throw new Error('the harness built no Content accordion header to focus');
foContent.focus();
togglePane(fo);
check('folding the pane hands focus to the control that closed it',
  fo.document.activeElement === fo.byId.outlineToggle);
// The other half, and the reason the handoff is a `contains` check rather than
// an unconditional focus(): folding must not reach out and take focus from
// somewhere else on the page.
const fb = run('');
fb.byId.contentPane.focus();
togglePane(fb);
check('...and leaves focus alone when it was somewhere else',
  fb.document.activeElement === fb.byId.contentPane);

// A resize while the pane is folded is what empties the outline, and the
// emptying is the browser's own doing rather than something this test arranged:
// the window listener redraws all three graphs, and a graph whose rows sit
// inside a `display:none` pane lays out none of them. drawGraph clears its svg
// before it gives up, so what the fold would come back to is a blank corner
// with nothing logged. The check in the middle is what makes the emptying the
// resize's doing and not the fold's.
//
const re = run('');
togglePane(re);
check('folding the pane hides the outline without wiping it',
  drawnIn(re.byId.graphContent).length > 0);
(re.winHandlers.resize ?? []).forEach((h) => { h(); });
re.flushAll();
check('a resize while the pane is folded leaves the outline empty',
  drawnIn(re.byId.graphContent).length === 0);
togglePane(re);
check('reopening the pane draws the outline again',
  drawnIn(re.byId.graphContent).length > 0);
check('...without reporting its rows lost', !postedLogs(re).some((m) => m.message.includes('outline')));

// And the same for a view whose accordion the reader had opened, which is what
// makes redrawing all three graphs the right answer rather than redrawing the
// one. Only Content is drawn at init; Tables and Diagrams draw when their
// accordion opens, and the accordion's state does not survive a reload — so a
// pane folded with Tables open is a page with lines to lose that no init-time
// draw would put back.
const rt = run('');
clickAccordion(rt, 'tables');
check('the Tables view is drawn once its accordion opens',
  drawnIn(rt.byId.graphTables).length > 0);
togglePane(rt);
(rt.winHandlers.resize ?? []).forEach((h) => { h(); });
rt.flushAll();
check('a resize while the pane is folded empties the Tables view too',
  drawnIn(rt.byId.graphTables).length === 0);
togglePane(rt);
check('reopening the pane draws the Tables view that was left open',
  drawnIn(rt.byId.graphTables).length > 0);

// ---- a scrollbar asked to sync while its pane is hidden ----
// The defect the fold creates: `display:none` measures as zero everywhere, and
// `0/0` is NaN — which does not throw. The thumb is handed the literal "NaNpx"
// for its height and its position, the style system takes both and applies
// neither, and the bar comes back from the fold invisible with nothing logged.
// The window resize listener is what reaches a hidden wrap: it fires whether or
// not the pane is showing.
const sb = run('');
const sbBody = sb.byId.tocPaneWrap.querySelector('.scroll-body');
const sbTrack = sb.byId.tocPaneWrap.querySelector('.scroll-track');
const sbThumb = sb.byId.tocPaneWrap.querySelector('.scroll-thumb');
if (!sbBody || !sbTrack || !sbThumb) throw new Error('the outline pane is missing a scrollbar part');
// Geometry the double has to be told, because it has no layout engine: a
// 100px-tall view of 200px of content, sitting at the halfway point, in a
// 200px track.
sbBody.clientHeight = 100;
sbBody.scrollHeight = 200;
sbBody.scrollTop = 50;
sbTrack.clientHeight = 200;
(sb.winHandlers.resize ?? []).forEach((h) => { h(); });
// The positive control comes first, so "wrote nothing" below cannot be
// satisfied by a sync that never writes: 100/200 of the track is 100px, and
// halfway down the remaining 100px is 50px.
check('an open scrollbar lays its thumb out as a fraction of the track',
  sbThumb.style.height === '100px' && sbThumb.style.top === '50px');
// What `display:none` measures as in a real layout.
sbBody.clientHeight = 0;
sbBody.scrollHeight = 0;
sbBody.scrollTop = 0;
sbTrack.clientHeight = 0;
sbThumb.style.height = '';
sbThumb.style.top = '';
(sb.winHandlers.resize ?? []).forEach((h) => { h(); });
check('a scrollbar synced while its pane is hidden writes nothing at all',
  sbThumb.style.height === '' && sbThumb.style.top === '');

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
const {
  resolveContentWidth,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_MAX,
  resolveRemoteImages,
  REMOTE_IMAGES_DEFAULT,
  resolveTypographer,
  TYPOGRAPHER_DEFAULT,
} = require('../src/settings.ts') as typeof import('../src/settings');

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

// The two boolean resolvers, on the same evidence and for the same reason.
// `remoteImages` decides whether a document may reach the network and had no
// check here at all; `typographer` is new, and a setting whose coercion is
// untested is one that reads backwards the first time somebody hand-edits it.
//
// Every case is built so a wrong implementation cannot agree with it by
// accident: the pass-throughs hand over a fallback that contradicts the value,
// so an "always fall back" resolver fails them, and the strings are the ones
// `Boolean()` gets backwards — `Boolean('false')` is `true`, which is the whole
// reason these resolvers are strict `typeof` checks rather than a cast.
check('remoteImages: a real boolean passes through', resolveRemoteImages(true, false));
check('...and a false one does too', !resolveRemoteImages(false, true));
check('remoteImages: the string "false" falls back rather than reading as true',
  resolveRemoteImages('false', REMOTE_IMAGES_DEFAULT) === REMOTE_IMAGES_DEFAULT);
check('remoteImages: a number that coerces falsy still falls back',
  resolveRemoteImages(0, true));
check('remoteImages: a missing setting falls back to the contributed default',
  resolveRemoteImages(undefined, REMOTE_IMAGES_DEFAULT) === REMOTE_IMAGES_DEFAULT);
check('typographer: a real boolean passes through', resolveTypographer(true, false));
check('...and a false one does too', !resolveTypographer(false, true));
check('typographer: the string "false" falls back rather than reading as true',
  !resolveTypographer('false', false));
check('typographer: a number that coerces falsy still falls back',
  resolveTypographer(0, TYPOGRAPHER_DEFAULT) === TYPOGRAPHER_DEFAULT);
check('typographer: a missing setting falls back to the contributed default',
  resolveTypographer(undefined, TYPOGRAPHER_DEFAULT) === TYPOGRAPHER_DEFAULT);

// ---- scroll position survives a re-render ----
const s1 = run('', { state: { scrollTop: 0, collapsed: [], 'stale-field': 'from an older build' } });
check('the store holds what the previous render left', 'stale-field' in s1.state);
s1.byId.contentPane.scrollTop = 250;
(s1.byId.contentPane._listeners.scroll ?? []).forEach((fn) => { fn(); });
s1.flushAll(); // the save is deferred to a rAF
check('scrolling stashes the position in webview state', s1.state.scrollTop === 250);
// And the save replaces the store rather than writing into it, which is what
// `vscode.setState` does in a real webview. That is the whole reason the field
// above exists: a persistState() that stopped writing a field would leave the
// previous value in the store, so the feature would look like it survived a
// re-render while never being saved — and against a merging double there is no
// way to tell that apart from its having been saved.
check('a save replaces the store rather than merging into it', !('stale-field' in s1.state));

const s2 = run('', { state: { scrollTop: 250 } });
check('a re-render restores the stashed scroll position', s2.byId.contentPane.scrollTop === 250);

const s3 = run('', { state: {} });
check('a re-render with no stash starts at the top', s3.byId.contentPane.scrollTop === 0);

// ---- a section the reader folded survives a re-render ----
// Collapse is a class on the element, and a re-render replaces every element —
// so without the copy kept in webview state, every keystroke sprang open every
// section the reader had closed. The symptom is the preview undoing something
// the reader did, which reads as the preview fighting back rather than as a
// missing feature, and nothing in the page accounts for it.
const folded = makeEl('div');
const untouched = makeEl('div');
run('', {
  state: { collapsed: ['body-folded'] },
  elements: { 'body-folded': folded, 'body-untouched': untouched },
});
check(
  'a re-render brings back the folded sections and only those',
  folded.classList.contains('collapsed') && !untouched.classList.contains('collapsed')
);

// An id the previous render produced and this one no longer has: the document
// deleted that section while the panel was showing another file. It is skipped
// rather than chased — and skipping has to not throw, since the id comes back
// out of a store this program does not own.
check('a remembered id the document no longer has is skipped', run('', { state: { collapsed: ['body-deleted'] } }).rows.length === 7);
// The store is the host's, so its contents are `unknown` until read — the same
// reason getState is typed the way it is. A value that is not a list of strings
// is ignored rather than iterated.
check('a collapsed value that is not a list is ignored', run('', { state: { collapsed: 'not-an-array' } }).rows.length === 7);

// ---- clicking a heading folds its section, and remembers it ----
// This handler moved from the heading element to the document when re-renders
// began replacing headings: bound to the element, it died with the element and
// left a heading that still looked clickable. What it does has not changed, so
// this is the assertion the per-element version would have carried.
const chev = makeEl('span');
chev.className = 'chev';
const clickHead = makeEl('h2');
clickHead.className = 'section-head';
clickHead.dataset.target = 'body-click';
clickHead.closest = (sel: string) => (sel === '.section-head' ? clickHead : null);
clickHead.querySelector = (sel: string) => (sel === '.chev' ? chev : null);
const clickBody = makeEl('div');
clickBody.className = 'section-body';

const hc = run('', { elements: { 'body-click': clickBody }, heads: { 'body-click': clickHead } });
fireClickOn(hc, clickHead);
check('a heading click folds its section', clickBody.classList.contains('collapsed'));
check('...and the arrow turns with it', chev.classList.contains('collapsed'));
check(
  '...and the fold is recorded for the next render',
  Array.isArray(hc.state.collapsed) && hc.state.collapsed.includes('body-click')
);

fireClickOn(hc, clickHead);
check('clicking it again unfolds the section', !clickBody.classList.contains('collapsed'));
check('...turns the arrow back', !chev.classList.contains('collapsed'));
check(
  '...and drops it from the record',
  Array.isArray(hc.state.collapsed) && !hc.state.collapsed.includes('body-click')
);

// ---- an outline that cannot lay itself out says so ----
// drawGraph keeps the rows that have a layout box. Rows that are not in the
// container — a stale reference to a previous build's rows — all filter out, the
// svg is cleared, and the pane is simply blank: nothing throws, nothing is
// logged, and the reader is looking at an outline with no entries and no reason.
// The container's own visibility is what separates that from a graph inside a
// folded accordion section, which is legitimately empty.
const detached = run('', { detachRows: true });
// Found by what it names rather than by being the only log in the list: the
// page posts a warning of its own while loading (below), so the first log is
// not the outline's.
const warned = postedLogs(detached).find((m) => m.message.includes('outline'));
check('an outline that laid out none of its rows says so', warned !== undefined && warned.level === 'warn');
check('...naming how many rows it could not place', warned?.message.includes('7') === true);
// The other half: a graph that drew itself is silent. Without this the check
// above would pass for a webview that warned on every draw. Scoped to the
// outline for the same reason the find above is.
check('...and an outline that drew itself warns about nothing',
  !postedLogs(base).some((m) => m.message.includes('outline')));

// ---- a document whose diagrams cannot be drawn says so ----
// Unreachable until the double stopped handing the webview `diagrams: []`: the
// webview warns only when it was given diagrams it has no mermaid to draw, so a
// graph built from an empty list could never reach this branch — the warning was
// not merely unasserted, it never ran.
//
// This is also what the message counts above are measured from rather than
// assuming zero, and the page it describes is the ordinary failure: the vendored
// script is what failed to load, and the document is perfectly fine.
const missingMermaid = postedLogs(base).find((m) => m.message.includes('mermaid'));
check('a document with diagrams and no mermaid warns', missingMermaid?.level === 'warn');
check('...saying how many diagrams will not be drawn',
  missingMermaid?.message.includes(`${diagramsTree.length}`) === true);
// The control: the warning is about the diagrams and not about every page. A
// document with none loads silently, which is what keeps the assertion above
// from passing for a webview that always warns.
check('a document with no diagrams loads without a word',
  run('', { diagrams: [] }).posted.length === 0);

// ---- a diagram that fails to render -> the host's Output Channel ----
// mermaid rejects asynchronously and this file is synchronous from top to
// bottom, so the rejection is stood in for by a thenable that runs its catch
// handler inline. Making the harness async to await one Promise.reject would
// mean making every check in the file async; the code under test only ever
// calls `.then().catch()`, so this exercises exactly that path, and what is
// asserted below is what the webview posted rather than anything about timing.
interface SyncThenable {
  then(): SyncThenable;
  catch(handler: (err: unknown) => void): SyncThenable;
}
const rejectedMermaid = (): SyncThenable => {
  const chain: SyncThenable = {
    then: () => chain,
    catch: (handler) => {
      handler(new Error('bad diagram'));
      return chain;
    },
  };
  return chain;
};

const mermaidFail = run('', { mermaid: { initialize() {}, run: rejectedMermaid } });
const logMsg = mermaidFail.posted.find((m) => m.type === 'log');
check('a diagram that fails to render posts a log message', logMsg !== undefined);
check('the log message is an error', logMsg?.level === 'error');
check(
  'the log message names what failed',
  typeof logMsg?.message === 'string' && logMsg.message.includes('mermaid')
);
// The stack is dropped at the sender, so this is asserting the sender's job
// rather than the host's — but it is the sender's job that keeps a bundle's
// internal frames out of a log the user reads.
check(
  'the log message carries no stack',
  typeof logMsg?.message === 'string' && !logMsg.message.includes('\n    at ')
);
check('a failed diagram posts nothing else', mermaidFail.posted.length === 1);

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

const sent = [...cl.posted, ...lk.posted, ...mermaidFail.posted];
check('the webview posted messages to check', sent.length > 0);
check('every message the webview sends passes the host guard', sent.every((m) => isWebviewToHost(m)));

// A guard that says yes to everything would pass the check above, so it has to
// be shown saying no.
check('the host guard rejects a toggleTask with no checked flag',
  !isWebviewToHost({ type: 'toggleTask', line: 5 }));
check('the host guard rejects a toggleTask with a string line',
  !isWebviewToHost({ type: 'toggleTask', line: '5', checked: true }));
check('the host guard rejects a log with a level it cannot route',
  !isWebviewToHost({ type: 'log', level: 'verbose', message: 'hi' }));
check('the host guard rejects a log with no message',
  !isWebviewToHost({ type: 'log', level: 'error' }));
check('the host guard rejects an unknown type', !isWebviewToHost({ type: 'nope' }));
check('the host guard rejects a bare string', !isWebviewToHost('toggleTask'));
check('the host guard rejects null', !isWebviewToHost(null));

// ---- every id the webview looks up is one the page actually has ----
// main.ts reaches its elements by id, and `byId` throws when one is missing —
// at load, before anything is drawn, so a renamed id in the markup turns the
// whole preview into a blank panel with one error in a console nobody has open.
// Nothing above can see this: the double builds its own elements from STUB_IDS,
// so it would go on passing while the real page had lost the id. This is the
// one check that reads the page the extension actually serves.
const htmlBundle = path.join(__dirname, '..', 'out', 'webview-html.bundle.js');
// buildSync rather than the async build: every check in this file is
// synchronous, and making the file async to await one build would mean making
// every check async with it.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'webviewHtml.ts')],
  bundle: true,
  outfile: htmlBundle,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  logLevel: 'silent',
});
const { buildWebviewHtml } = require(htmlBundle) as typeof import('../src/webviewHtml');
const page = buildWebviewHtml({
  mediaDir: path.join(__dirname, '..', 'media'),
  toWebviewUri: (absPath: string) => `https://webview.test/${path.basename(absPath)}`,
  cspSource: 'https://webview.test',
  remoteImages: false,
  contentWidth: 60,
  bodyHtml: '<p>body</p>',
  headings: [],
  tables: [],
  diagrams: [],
});
const idsInPage = new Set([...page.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
// Read out of the source rather than listed here, so an id added to the
// webview is covered the moment it is written. The count guard is the other
// half: a pattern that stopped matching would leave this checking nothing.
const lookedUp = [
  ...fs
    .readFileSync(path.join(__dirname, '..', 'src', 'webview', 'main.ts'), 'utf8')
    .matchAll(/byId\('([^']+)'\)/g),
].map((m) => m[1] ?? '');
check(
  `the page carries every id the webview looks up (${lookedUp.length} found)`,
  lookedUp.length > 0 && lookedUp.every((id) => idsInPage.has(id)),
  `      the page is missing: ${lookedUp.filter((id) => !idsInPage.has(id)).join(', ')}`
);

console.log(failures === 0 ? '\nAll graph checks passed.' : `\n${failures} graph check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
