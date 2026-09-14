// One-off check: runs media/preview.js against a tiny DOM stub to verify the
// graph builder lays out edges correctly at arbitrary depth. Run:
//   node scripts/graph-check.js
// (Not part of the build; kept for future preview.js changes.)
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

function makeEl(tag) {
  return {
    tag,
    children: [],
    attrs: {},
    style: { setProperty() {} },
    className: '',
    dataset: {},
    textContent: '',
    title: '',
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    offsetParent: {}, // visible
    offsetTop: 0,
    offsetHeight: 32,
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
    addEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) { return this.children.find((c) => c.className && c.className.split(' ').includes(sel.slice(1))) || null; },
    querySelectorAll() { return []; },
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; },
      contains(c) { return this.set.has(c); },
    },
    getBoundingClientRect() { return { top: 0 }; },
    closest() { return null; },
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

// builds fresh stubs, runs preview.js, lays out rows, and returns the
// built rows + svg after the init rAF has flushed. `spyTarget` is the
// .section-head the scroll-spy reports, i.e. which row ends up active.
function run(spyTarget) {
  const byId = {};
  ['graphContent', 'graphTables', 'graphDiagrams', 'contentPane', 'contentInner'].forEach((id) => {
    const el = makeEl('div');
    el.id = id;
    byId[id] = el;
  });
  const docEl = makeEl('html');
  const handlers = {};
  const document = {
    documentElement: docEl,
    createElement: (tag) => makeEl(tag),
    createElementNS: (_ns, tag) => makeEl(tag),
    getElementById: (id) => byId[id],
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('.section-head') && spyTarget) {
        return [{ dataset: { target: spyTarget }, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {} }];
      }
      return [];
    },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  };
  const rafQueue = [];
  const window = {
    addEventListener() {},
    ResizeObserver: undefined,
    mermaid: undefined,
    __PREVIEW_DATA__: { headings: tree, tables: [], diagrams: [] },
  };
  // like a real browser, rAF callbacks receive a high-res timestamp
  let clock = 0;
  const performance = { now: () => (clock += 120) };
  const requestAnimationFrame = (cb) => { rafQueue.push(() => cb(performance.now())); };
  const acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage() {} });
  const getComputedStyle = () => ({ getPropertyValue: (v) => (v === '--border-strong' ? '#000' : v === '--accent' ? '#f00' : '') });

  const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'preview.js'), 'utf8');
  const fn = new Function('window', 'document', 'requestAnimationFrame', 'performance', 'acquireVsCodeApi', 'getComputedStyle', src);
  fn(window, document, requestAnimationFrame, performance, acquireVsCodeApi, getComputedStyle);

  const graph = byId.graphContent;
  const rows = graph.children.filter((c) => c.className && c.className.includes('toc-row'));
  rows.forEach((r, i) => { r.offsetTop = i * 32; r.offsetHeight = 32; });
  graph.scrollHeight = rows.length * 32;
  rafQueue.splice(0).forEach((cb) => cb()); // init rAF: drawGraph + onScroll

  const svg = graph.children.find((c) => c.tag === 'svg');
  const drawn = svg.children.map((e) => ({
    line: e.tag === 'line' ? { x1: e.attrs.x1, y1: e.attrs.y1, x2: e.attrs.x2, y2: e.attrs.y2 } : null,
    path: e.tag === 'path' ? e.attrs.d : null,
    stroke: e.attrs.stroke,
    opacity: e.attrs.opacity,
  }));
  const flushAll = () => {
    for (let i = 0; i < 40 && rafQueue.length; i++) {
      rafQueue.splice(0).forEach((cb) => cb());
    }
  };
  return { rows, svg, drawn, document, handlers, byId, flushAll };
}

const rowLabel = (r) => r.children.find((c) => c.className === 'label').textContent;
const dotLeft = (r) => parseInt(r.children.find((c) => c.className === 'toc-dot').style.left || '0', 10);

// ---- structure ----
const base = run('');
const { rows, svg, drawn } = base;
check('7 rows built (A,B,C,D,E,F,G)', rows.length === 7);
check('labels in document order', rows.map(rowLabel).join('') === 'ABCDEFG');
check('depths -> dot x (14,34,54,74,94)', rows.map(dotLeft).join(',') === '14,34,54,74,94,34,14');
check('depth-0 rows have depth-0 class', rows.filter((r) => r.className.includes('depth-0')).length === 2);
check('row indent = dot x + 18', rows.every((r) => parseInt(r.style.paddingLeft, 10) === dotLeft(r) + 18));

// ---- base edges (rows are 32px -> centers at 16,48,80,112,144,176,208) ----
check('1 trunk line (A->G)', drawn.filter((e) => e.line && e.stroke === '#000').length === 1);
check('5 branch edges (B,C,D,E,F)', drawn.filter((e) => e.path && e.stroke === '#000').length === 5);
check('no accent strokes without an active row', drawn.filter((e) => e.stroke === '#f00').length === 0);
check('B curve from A', drawn.some((e) => e.path === 'M14,16 C14,32 34,32 34,48' && e.stroke === '#000'));
check('E curve from D at x=74->94', drawn.some((e) => e.path === 'M74,112 C74,128 94,128 94,144' && e.stroke === '#000'));
check('F re-curves from A (after deep subtree)', drawn.some((e) => e.path === 'M14,16 C14,96 34,96 34,176' && e.stroke === '#000'));
check('svg width covers deepest level', parseInt(svg.attrs.width, 10) >= 106);

// ---- accents, driven the way the real app does it (scroll-spy) ----
const b = run('b');
const accentsB = b.drawn.filter((e) => e.stroke === '#f00');
check('active B -> 1 accent segment (A->B)', accentsB.length === 1 && accentsB[0].path === 'M14,16 C14,32 34,32 34,48');

const f = run('f');
const accentsF = f.drawn.filter((e) => e.stroke === '#f00');
check('active F -> accent curve from A (matches base edge)', accentsF.length === 1 && accentsF[0].path === 'M14,16 C14,96 34,96 34,176');

const c = run('c');
const accentsC = c.drawn.filter((e) => e.stroke === '#f00');
check('active C -> 2 accent segments (A->B, B->C)',
  accentsC.length === 2
  && accentsC.some((e) => e.path === 'M14,16 C14,32 34,32 34,48')
  && accentsC.some((e) => e.path === 'M34,48 C34,64 54,64 54,80'));

// ---- in-page anchor clicks (footnote backref) ----
const sim = run('');
const pane = sim.byId.contentPane;
const clickHandlers = sim.handlers.click;

function makeAnchor(href) {
  const a = makeEl('a');
  a.getAttribute = (k) => (k === 'href' ? href : null);
  a.closest = (sel) => (sel === 'a[href^="#"]' ? a : null);
  return a;
}
function fireClick(anchor) {
  const e = { target: anchor, prevented: false, preventDefault() { this.prevented = true; } };
  clickHandlers.forEach((h) => h(e));
  sim.flushAll(); // run the scroll animation to completion
  return e;
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
check('backref click is intercepted (preventDefault)', ev.prevented === true);

// anchor with a target that does not exist -> left alone, no scrolling
const dead = makeAnchor('#nope');
pane.scrollTop = 123;
const ev2 = fireClick(dead);
check('dead anchor left alone (no preventDefault, no scroll)', ev2.prevented === false && pane.scrollTop === 123);

console.log(failures === 0 ? '\nAll graph checks passed.' : `\n${failures} graph check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
