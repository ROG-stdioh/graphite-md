(function () {
  const vscode = acquireVsCodeApi();
  const previewData = window.__PREVIEW_DATA__ || { headings: [], tables: [], diagrams: [] };

  // Reading width is set once, server-side, as an inline CSS var on <body>
  // (see extension.ts) — no client-side default needed here.

  // ================= generic graph builder (always fully expanded — no per-node collapse) =================
  const svgNS = 'http://www.w3.org/2000/svg';
  const TRUNK_X = 14;  // x of depth-0 dots and the trunk line
  const STEP_X = 20;   // horizontal offset per nesting level

  function dotX(depth) { return TRUNK_X + depth * STEP_X; }

  function buildGraph(container, data) {
    const svg = document.createElementNS(svgNS, 'svg');
    container.appendChild(svg);
    const rows = [];

    if (!data || data.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'Nothing here yet.';
      container.appendChild(empty);
    }

    // rows are built recursively so the outline can nest to any depth
    // (H2 -> H6 in one chain means depth 4); each row keeps a ref to its
    // parent row, which drawGraph uses to lay out the branch edges
    function addRow(node, depth, parent) {
      const row = document.createElement('div');
      row.className = depth === 0 ? 'toc-row depth-0' : 'toc-row';
      row.style.paddingLeft = (dotX(depth) + 18) + 'px';
      row.dataset.target = node.target;

      const dot = document.createElement('div');
      dot.className = 'toc-dot';
      dot.style.left = dotX(depth) + 'px';
      row.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = node.label;
      label.title = node.label; // full text on hover when ellipsis truncates it
      row.appendChild(label);

      container.appendChild(row);
      const rec = { el: row, dot, target: node.target, depth, parent: parent || null };
      rows.push(rec);
      (node.children || []).forEach((child) => addRow(child, depth + 1, rec));
    }

    (data || []).forEach((node) => addRow(node, 0, null));

    rows.forEach((r) => {
      r.dot.addEventListener('click', (e) => { e.stopPropagation(); navigateTo(r.target); });
      r.el.querySelector('.label').addEventListener('click', (e) => { e.stopPropagation(); navigateTo(r.target); });
    });

    function rowCenterY(rowEl) { return rowEl.offsetTop + rowEl.offsetHeight / 2; }

    function drawGraph() {
      const visible = rows.filter((r) => r.el.offsetParent !== null);
      svg.innerHTML = '';
      if (visible.length === 0) return;

      const totalH = container.scrollHeight;
      const maxDepth = visible.reduce((max, r) => Math.max(max, r.depth), 0);
      svg.setAttribute('width', dotX(maxDepth) + 12);
      svg.setAttribute('height', totalH);

      // trunk: vertical line joining consecutive depth-0 rows
      const trunkRows = visible.filter((r) => r.depth === 0);
      for (let i = 0; i < trunkRows.length - 1; i++) {
        addLine(TRUNK_X, rowCenterY(trunkRows[i].el), TRUNK_X, rowCenterY(trunkRows[i + 1].el), 'border-strong', 2);
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
      if (activeRow && trunkRows.length) {
        const chain = [];
        for (let cur = activeRow; cur; cur = cur.parent) chain.unshift(cur);
        const trunkTop = rowCenterY(trunkRows[0].el);
        const chainTopY = rowCenterY(chain[0].el);
        if (chainTopY > trunkTop) {
          addLine(TRUNK_X, trunkTop, TRUNK_X, chainTopY, 'accent', 2, 0.9);
        }
        for (let i = 1; i < chain.length; i++) {
          const child = chain[i], parent = chain[i - 1];
          const px = dotX(parent.depth), py = rowCenterY(parent.el);
          const cx = dotX(child.depth), cy = rowCenterY(child.el);
          const sibIdx = visible.indexOf(child);
          const prev = sibIdx > 0 ? visible[sibIdx - 1] : null;
          if (prev && prev.depth === child.depth && prev.parent === parent) {
            // later sibling: accent runs from the first sibling down to this one
            let firstSib = child;
            for (let j = sibIdx - 1; j >= 0 && visible[j].depth === child.depth && visible[j].parent === parent; j--) firstSib = visible[j];
            const fy = rowCenterY(firstSib.el);
            const midY = (py + fy) / 2;
            addPath(`M${px},${py} C${px},${midY} ${cx},${midY} ${cx},${fy}`, 'accent', 2, 0.9);
            if (firstSib !== child) addLine(cx, fy, cx, cy, 'accent', 2, 0.9);
          } else {
            const midY = (py + cy) / 2;
            addPath(`M${px},${py} C${px},${midY} ${cx},${midY} ${cx},${cy}`, 'accent', 2, 0.9);
          }
        }
      }
    }

    function addLine(x1, y1, x2, y2, colorVar, width, opacity) {
      const l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--' + colorVar));
      l.setAttribute('stroke-width', width);
      l.setAttribute('opacity', opacity === undefined ? 1 : opacity);
      svg.appendChild(l);
    }
    function addPath(d, colorVar, width, opacity) {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--' + colorVar));
      p.setAttribute('stroke-width', width);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('opacity', opacity === undefined ? 1 : opacity);
      svg.appendChild(p);
    }

    function setActive(id) {
      rows.forEach((r) => r.el.classList.toggle('active', r.target === id));
      drawGraph();
    }

    drawGraph();
    return { rows, drawGraph, setActive };
  }

  const contentGraph = buildGraph(document.getElementById('graphContent'), previewData.headings);
  const tablesGraph = buildGraph(document.getElementById('graphTables'), previewData.tables);
  const diagramsGraph = buildGraph(document.getElementById('graphDiagrams'), previewData.diagrams);

  const sectionMap = {
    content: { graph: contentGraph, header: document.querySelector('.accordion-header[data-view="content"]'), body: document.getElementById('graphContent') },
    tables: { graph: tablesGraph, header: document.querySelector('.accordion-header[data-view="tables"]'), body: document.getElementById('graphTables') },
    diagrams: { graph: diagramsGraph, header: document.querySelector('.accordion-header[data-view="diagrams"]'), body: document.getElementById('graphDiagrams') },
  };

  function findRow(id) {
    for (const key in sectionMap) {
      const r = sectionMap[key].graph.rows.find((rr) => rr.target === id);
      if (r) return { graph: sectionMap[key].graph, viewName: key, row: r };
    }
    return null;
  }

  // ================= accordion: at most one section expanded =================
  function collapseAllSections() {
    Object.values(sectionMap).forEach((s) => { s.header.classList.remove('expanded'); s.body.classList.add('collapsed'); });
  }
  function expandSection(view) {
    collapseAllSections();
    const s = sectionMap[view];
    s.header.classList.add('expanded');
    s.body.classList.remove('collapsed');
    requestAnimationFrame(() => s.graph.drawGraph());
  }
  document.querySelectorAll('.accordion-header').forEach((header) => {
    header.addEventListener('click', () => {
      const view = header.dataset.view;
      if (header.classList.contains('expanded')) {
        collapseAllSections();
      } else {
        expandSection(view);
      }
    });
  });

  // ================= collapsible content sections (prose collapse — separate
  //                    from the TOC graph, which is never collapsible itself) =================
  document.querySelectorAll('.section-head').forEach((head) => {
    head.addEventListener('click', () => {
      const body = document.getElementById(head.dataset.target);
      const chev = head.querySelector('.chev');
      body.classList.toggle('collapsed');
      chev.classList.toggle('collapsed');
    });
  });

  function expandAncestors(headEl) {
    let node = headEl.closest('.section-body');
    while (node) {
      node.classList.remove('collapsed');
      const parentHead = document.querySelector(`[data-target="${node.id}"].section-head`);
      if (parentHead) {
        const chev = parentHead.querySelector('.chev');
        if (chev) chev.classList.remove('collapsed');
      }
      node = node.parentElement ? node.parentElement.closest('.section-body') : null;
    }
  }

  // ================= soft (eased) scroll-to, with a lock so scroll-spy
  //                    can't fight the click mid-animation =================
  let navLock = false;

  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function animateScrollTo(el, target, duration, onDone) {
    duration = duration || 520;
    const start = el.scrollTop;
    const change = target - start;
    if (Math.abs(change) < 1) { if (onDone) onDone(); return; }
    const startTime = performance.now();
    function step(now) {
      const elapsed = Math.min((now - startTime) / duration, 1);
      el.scrollTop = start + change * easeInOutCubic(elapsed);
      if (elapsed < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    requestAnimationFrame(step);
  }

  function pulseDot(id) {
    const found = findRow(id);
    if (!found) return;
    found.row.dot.classList.remove('pulse');
    void found.row.dot.offsetWidth;
    found.row.dot.classList.add('pulse');
  }

  function navigateTo(id) {
    const body = document.getElementById(id);
    const head = document.querySelector(`[data-target="${id}"].section-head`);
    if (body) {
      body.classList.remove('collapsed');
      if (head) head.querySelector('.chev').classList.remove('collapsed');
    }
    if (head) expandAncestors(head);

    const found = findRow(id);
    if (found) {
      if (sectionMap[found.viewName].body.classList.contains('collapsed')) {
        expandSection(found.viewName);
      }
      found.graph.setActive(id);
    }

    const pane = document.getElementById('contentPane');
    const target = head || body;
    navLock = true;
    if (target) {
      const targetTop = pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 24;
      animateScrollTo(pane, targetTop, 520, () => {
        navLock = false;
        if (found) found.graph.setActive(id);
      });
    } else {
      navLock = false;
    }
    pulseDot(id);
  }

  // ================= custom overlay scrollbars =================
  function attachScrollbar(wrap) {
    const body = wrap.querySelector('.scroll-body');
    const thumb = wrap.querySelector('.scroll-thumb');
    const track = wrap.querySelector('.scroll-track');
    let hideTimer = null;

    function sync() {
      const trackH = track.clientHeight;
      const ratio = body.clientHeight / body.scrollHeight;
      if (ratio >= 1) { thumb.style.opacity = '0'; thumb.style.pointerEvents = 'none'; return; }
      thumb.style.pointerEvents = 'auto';
      const thumbH = Math.max(ratio * trackH, 24);
      const maxThumbTop = trackH - thumbH;
      const scrollRatio = body.scrollTop / (body.scrollHeight - body.clientHeight);
      thumb.style.height = thumbH + 'px';
      thumb.style.top = (scrollRatio * maxThumbTop) + 'px';
    }
    function showThenFade() {
      wrap.classList.add('scrolling');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => wrap.classList.remove('scrolling'), 700);
    }
    body.addEventListener('scroll', () => { sync(); showThenFade(); }, { passive: true });
    window.addEventListener('resize', sync);

    let dragging = false, dragStartY = 0, dragStartScroll = 0;
    thumb.addEventListener('mousedown', (e) => {
      dragging = true; thumb.classList.add('dragging');
      dragStartY = e.clientY; dragStartScroll = body.scrollTop;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const trackH = track.clientHeight;
      const scrollRange = body.scrollHeight - body.clientHeight;
      const deltaY = e.clientY - dragStartY;
      body.scrollTop = dragStartScroll + (deltaY / trackH) * scrollRange;
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; thumb.classList.remove('dragging'); } });
    sync();
  }
  document.querySelectorAll('.scroll-wrap').forEach(attachScrollbar);

  // ================= scroll-spy (content headings only, suppressed while navLock is true) =================
  const contentPane = document.getElementById('contentPane');
  const headings = Array.from(document.querySelectorAll('.section-head'));

  function onScroll() {
    if (navLock) return;
    let currentId = headings[0] ? headings[0].dataset.target : null;
    const paneTop = contentPane.getBoundingClientRect().top;
    for (const h of headings) {
      const r = h.getBoundingClientRect();
      if (r.top - paneTop < 80) currentId = h.dataset.target;
    }
    contentGraph.setActive(currentId);
  }
  contentPane.addEventListener('scroll', onScroll);

  // ================= reading width — live sync if settings.json is edited
  //                    directly while the preview is open (no in-panel UI) =================
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'contentWidth') {
      document.body.style.setProperty('--content-width', msg.value + '%');
    }
  });

  // ================= checklist checkboxes — click writes back to the source file =================
  document.addEventListener('click', (e) => {
    const box = e.target.closest ? e.target.closest('.task-checkbox') : null;
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
    const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return; // no matching element — leave the click alone
    e.preventDefault();

    // the target may sit in a section the user collapsed (a footnote
    // backref points back into text that may have been folded away) — open
    // it, and any ancestor sections, first
    let body = target.closest('.section-body');
    while (body) {
      body.classList.remove('collapsed');
      const parentHead = document.querySelector(`[data-target="${body.id}"].section-head`);
      if (parentHead) {
        const chev = parentHead.querySelector('.chev');
        if (chev) chev.classList.remove('collapsed');
      }
      body = body.parentElement ? body.parentElement.closest('.section-body') : null;
    }

    const pane = document.getElementById('contentPane');
    const targetTop = pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 24;
    navLock = true;
    animateScrollTo(pane, targetTop, 520, () => {
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
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return; // in-page anchors handled above
    e.preventDefault();
    vscode.postMessage({ type: 'openLink', href });
  });

  // ================= halftone dot grid — computed from real pixel size, never stretched =================
  function buildHalftone(el) {
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
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
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
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', rad);
        circle.setAttribute('fill', dotColor);
        svg.appendChild(circle);
      }
    }
  }

  const callouts = Array.from(document.querySelectorAll('.callout'));
  callouts.forEach(buildHalftone);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver((entries) => { entries.forEach((entry) => buildHalftone(entry.target)); });
    callouts.forEach((el) => ro.observe(el));
  } else {
    window.addEventListener('resize', () => callouts.forEach(buildHalftone));
  }

  // ================= scroll position survives re-renders =================
  // Every edit to the source file re-sends webview.html (see extension.ts),
  // which reloads this page — without this, toggling a checkbox or typing a
  // keystroke snaps the preview back to the top. Webview state persists
  // across setHtml calls (only a panel close loses it), so we stash the
  // scroll position there and restore it on load.
  const persisted = vscode.getState() || {};
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
  contentPane.addEventListener('wheel', () => { userScrolled = true; }, { passive: true });

  // ================= mermaid =================
  // startOnLoad is off because we render the diagrams ourselves, so we can
  // re-apply the restored scroll position once the diagrams change the
  // page height (mermaid replaces each .mermaid's content asynchronously)
  if (window.mermaid) {
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
    mermaid.run({ querySelector: '.mermaid' })
      .then(() => {
        if (!userScrolled && contentPane.scrollHeight !== heightBefore && typeof persisted.scrollTop === 'number') {
          contentPane.scrollTop = persisted.scrollTop;
        }
      })
      .catch((err) => console.error('graphite.md: failed to render mermaid diagrams', err));
  }

  // ================= init =================
  requestAnimationFrame(() => {
    contentGraph.drawGraph();
    onScroll();
    if (typeof persisted.scrollTop === 'number') contentPane.scrollTop = persisted.scrollTop;
  });
  window.addEventListener('resize', () => requestAnimationFrame(() => {
    contentGraph.drawGraph(); tablesGraph.drawGraph(); diagramsGraph.drawGraph();
  }));
})();
