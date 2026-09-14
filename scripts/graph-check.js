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
    // setProperty records onto the object itself, so `style.getPropertyValue`
    // style reads and plain `style.height = ...` assignments both work — the
    // code under test uses both forms.
    style: { setProperty(k, v) { this[k] = v; } },
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
    // Listeners are recorded rather than dropped. Nothing fires them
    // implicitly — tests reach them via the element's _listeners — but a
    // no-op here would make the accordion, the scrollbar drag and the
    // scroll-position save untestable while still looking registered.
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
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
function run(spyTarget, opts) {
  opts = opts || {};
  const byId = {};
  ['graphContent', 'graphTables', 'graphDiagrams', 'contentPane', 'contentInner'].forEach((id) => {
    const el = makeEl('div');
    el.id = id;
    byId[id] = el;
  });
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
  const accordionByView = {};
  accordionHeaders.forEach((h) => { accordionByView[h.dataset.view] = h; });

  const handlers = {};
  const document = {
    documentElement: docEl,
    body: bodyEl,
    createElement: (tag) => makeEl(tag),
    createElementNS: (_ns, tag) => makeEl(tag),
    getElementById: (id) => byId[id],
    querySelector: (sel) => {
      const m = /^\.accordion-header\[data-view="(\w+)"\]$/.exec(sel);
      return m ? (accordionByView[m[1]] || null) : null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.accordion-header') return accordionHeaders;
      if (sel.includes('.section-head') && spyTarget) {
        return [{ dataset: { target: spyTarget }, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {} }];
      }
      return [];
    },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  };
  const rafQueue = [];
  const winHandlers = {};
  const window = {
    addEventListener(type, fn) { (winHandlers[type] = winHandlers[type] || []).push(fn); },
    ResizeObserver: undefined,
    mermaid: undefined,
    __PREVIEW_DATA__: { headings: tree, tables: [], diagrams: [] },
  };
  // like a real browser, rAF callbacks receive a high-res timestamp
  let clock = 0;
  const performance = { now: () => (clock += 120) };
  const requestAnimationFrame = (cb) => { rafQueue.push(() => cb(performance.now())); };
  // Both directions are recorded. `postMessage(){}` and `getState: () => ({})`
  // were no-ops, so the entire host contract and the scroll restore were
  // unassertable while appearing to be wired up.
  const posted = [];
  const state = Object.assign({}, opts.state || {});
  const acquireVsCodeApi = () => ({
    getState: () => state,
    setState: (s) => Object.assign(state, s),
    postMessage: (m) => posted.push(m),
  });
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
  return { rows, svg, drawn, document, handlers, byId, flushAll, posted, state, winHandlers, accordionByView };
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

// ==================== the host contract ====================
// Everything below is what the webview says *to the host*, or what the host
// says to it. None of it was covered before: postMessage was a no-op, so
// these messages were produced into nothing and never asserted.

function fireClickOn(sim, target) {
  const e = { target, prevented: false, preventDefault() { this.prevented = true; } };
  sim.handlers.click.forEach((h) => h(e));
  sim.flushAll();
  return e;
}
// Guarded so a missing message reports FAIL instead of throwing and taking
// the rest of the run down with it.
function sendCheckbox(sim, line, checked) {
  const box = makeEl('span');
  box.className = 'task-checkbox';
  if (line !== undefined) box.dataset.line = String(line);
  if (checked) box.classList.add('checked');
  box.closest = (sel) => (sel === '.task-checkbox' ? box : null);
  fireClickOn(sim, box);
  return box;
}

// ---- checklist click -> toggleTask ----
const cl = run('');
const msg = (i) => cl.posted[i] || {};
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
function makeLink(href) {
  const a = makeEl('a');
  a.closest = (sel) => (sel === 'a[href]' ? a : null);
  a.getAttribute = (k) => (k === 'href' ? href : null);
  return a;
}
const lk = run('');
const linkEv = fireClickOn(lk, makeLink('setup.md'));
check('a relative link is handed to the host',
  lk.posted.length === 1 && lk.posted[0].type === 'openLink' && lk.posted[0].href === 'setup.md');
check('a relative link click is intercepted', linkEv.prevented === true);

const lk2 = run('');
fireClickOn(lk2, makeLink('#fnref1'));
check('an in-page anchor is not sent to the host', lk2.posted.length === 0);

const lk3 = run('');
fireClickOn(lk3, makeLink(''));
check('an empty href posts nothing', lk3.posted.length === 0);

// ---- accordion: at most one section open ----
const ac = run('');
function clickAccordion(sim, view) {
  (sim.accordionByView[view]._listeners.click || []).forEach((fn) => fn());
  sim.flushAll();
}
clickAccordion(ac, 'content');
check('clicking a section header opens it',
  ac.accordionByView.content.classList.contains('expanded')
  && !ac.byId.graphContent.classList.contains('collapsed'));
check('opening a section closes the others',
  ac.byId.graphTables.classList.contains('collapsed')
  && ac.byId.graphDiagrams.classList.contains('collapsed')
  && !ac.accordionByView.tables.classList.contains('expanded'));

clickAccordion(ac, 'diagrams');
check('opening another section closes the first (at most one open)',
  ac.accordionByView.diagrams.classList.contains('expanded')
  && !ac.byId.graphDiagrams.classList.contains('collapsed')
  && !ac.accordionByView.content.classList.contains('expanded')
  && ac.byId.graphContent.classList.contains('collapsed'));

clickAccordion(ac, 'diagrams');
check('clicking the open section closes it',
  !ac.accordionByView.diagrams.classList.contains('expanded')
  && ac.byId.graphDiagrams.classList.contains('collapsed'));

// ---- contentWidth message -> CSS variable ----
const cw = run('');
cw.winHandlers.message.forEach((h) => h({ data: { type: 'contentWidth', value: 80 } }));
check('contentWidth sets the reading-width variable', cw.document.body.style['--content-width'] === '80%');
cw.winHandlers.message.forEach((h) => h({ data: { type: 'somethingElse' } }));
check('an unrelated message leaves the width alone', cw.document.body.style['--content-width'] === '80%');

// ---- scroll position survives a re-render ----
const s1 = run('');
s1.byId.contentPane.scrollTop = 250;
(s1.byId.contentPane._listeners.scroll || []).forEach((fn) => fn());
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
const { isWebviewToHost } = require('../src/shared/protocol.ts');

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
