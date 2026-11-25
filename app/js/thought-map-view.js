(function () {
  'use strict';

  const SJ = (window.SJ = window.SJ || {});

  function openThoughtMap(options) {
    const graphApi = SJ.thoughtGraph;
    const organic = SJ.organicLayout;
    const preferenceApi = SJ.preferenceVector;
    const u = SJ.util;
    const session = options.session || null;
    const bubble = options.bubble;
    const savedMaps = session && session.thoughtMaps && !Array.isArray(session.thoughtMaps) ? session.thoughtMaps : {};
    const saved = savedMaps[bubble.id];
    let graph = saved && saved.rootId === bubble.id && Array.isArray(saved.nodes)
      ? saved
      : graphApi.createGraphFromBubble(bubble, options);
    let preferences = preferenceApi.createPreferences(session && session.expansionPreferences);
    let focusPreferences = SJ.graphKeywords.createFocusPreferences(session && session.focusPreferences);
    let focusModel = null;
    let selectedId = graph.rootId;
    let busy = false;
    let menuNodeId = null;
    let frameId = 0;
    let lastFrame = 0;
    let networkTime = 0;
    let dragging = null;
    let suppressNodeClick = false;
    let disposed = false;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let autoFlow = !motionQuery.matches;

    const overlay = document.createElement('section');
    overlay.className = 'thought-map-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'thought-map-title');
    overlay.innerHTML = `
      <h2 id="thought-map-title" class="sr-only">${u.esc(bubble.text)}</h2>
      <div class="thought-map-viewport" data-map-viewport tabindex="0" aria-label="自由思维网络。拖动节点整理位置，拖动空白移动网络，滚轮缩放。右键或长按节点打开菜单，Shift+F10 也可打开。">
        <svg class="thought-map-edges" data-map-edges aria-hidden="true"></svg>
        <div class="thought-map-nodes" data-map-nodes></div>
      </div>
      <button type="button" class="thought-map-close" data-map-close aria-label="关闭思维导图，返回星落">×</button>
      <aside class="thought-drawer" data-drawer hidden aria-label="节点资料与偏好"></aside>
      <div class="thought-context-menu" data-context-menu hidden role="menu" aria-label="节点扩展菜单"></div>
      <p class="sr-only" role="status" aria-live="polite" data-map-status></p>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const viewport = overlay.querySelector('[data-map-viewport]');
    const nodesLayer = overlay.querySelector('[data-map-nodes]');
    const edgesLayer = overlay.querySelector('[data-map-edges]');
    const drawer = overlay.querySelector('[data-drawer]');
    const menu = overlay.querySelector('[data-context-menu]');
    const status = overlay.querySelector('[data-map-status]');
    const camera = { x: 0, y: 0, scale: 0.92 };
    let worldWidth = 1200;
    let worldHeight = 780;
    let layout = {};
    const newborn = new Set();

    function nodeById(id) {
      return graph.nodes.find((node) => node.id === id) || null;
    }

    function announce(text) {
      status.textContent = '';
      window.setTimeout(() => { status.textContent = text; }, 20);
    }

    function plainPositions() {
      const value = {};
      Object.keys(layout).forEach((id) => { value[id] = { x: layout[id].x, y: layout[id].y }; });
      return value;
    }

    function persist() {
      graph.positions = plainPositions();
      if (!session) return;
      const thoughtMaps = Object.assign({}, savedMaps, { [graph.rootId]: graph });
      session.thoughtMaps = thoughtMaps;
      session.expansionPreferences = preferences;
      session.focusPreferences = focusPreferences;
      if (typeof options.onSave === 'function') options.onSave({ thoughtMaps, expansionPreferences: preferences, focusPreferences });
    }

    function syncLayout(options) {
      const opts = options || {};
      worldWidth = Math.max(1000, viewport.clientWidth * 1.45);
      worldHeight = Math.max(720, viewport.clientHeight * 1.3);
      layout = organic.createOrganicLayout(graph, {
        width: worldWidth,
        height: worldHeight,
        existing: layout,
        enteringIds: opts.animate ? opts.enteringIds : [],
      });
    }

    function originLabel(node) {
      if (node.sourceOrigin === 'ai') return node.labelOrigin === 'user_edit' ? 'AI · 你修改' : node.demo ? '演示候选' : 'AI 候选';
      if (node.sourceOrigin === 'demo') return '演示片段';
      if (node.sourceOrigin === 'public') return 'DeliData 公开原话';
      return node.labelOrigin === 'user_edit' ? '你修改的标题' : '你的原话';
    }

    function visibleEdges() {
      return graph.edges.filter((edge) => layout[edge.from] && layout[edge.to]);
    }

    function screenPosition(id) {
      const point = layout[id];
      return { x: (point.x - camera.x) * camera.scale, y: (point.y - camera.y) * camera.scale };
    }

    function drawFrame() {
      Object.keys(layout).forEach((id) => {
        const element = nodesLayer.querySelector('[data-map-node="' + CSS.escape(id) + '"]');
        if (!element) return;
        const point = screenPosition(id);
        element.style.transform = 'translate(' + point.x.toFixed(2) + 'px,' + point.y.toFixed(2) + 'px) translate(-50%, -50%)';
      });
      visibleEdges().forEach((edge) => {
        const group = edgesLayer.querySelector('[data-edge-id="' + CSS.escape(edge.id) + '"]');
        if (!group) return;
        const curve = organic.curvedEdge(screenPosition(edge.from), screenPosition(edge.to), edge, networkTime);
        group.querySelector('path').setAttribute('d', curve.d);
        const text = group.querySelector('text');
        text.setAttribute('x', curve.labelX);
        text.setAttribute('y', curve.labelY - 7);
      });
    }

    function frame(now) {
      if (disposed) return;
      frameId = window.requestAnimationFrame(frame);
      if (now - lastFrame < 32) return;
      const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 30;
      lastFrame = now;
      networkTime += dt;
      if (autoFlow && !motionQuery.matches) {
        layout = organic.stepOrganicLayout(layout, visibleEdges(), dt, {
          time: networkTime,
          width: worldWidth,
          height: worldHeight,
          pinnedId: dragging && dragging.nodeId,
        });
      }
      if (camera.goal) {
        const blend = 1 - Math.exp(-dt * 5);
        camera.x += (camera.goal.x - camera.x) * blend;
        camera.y += (camera.goal.y - camera.y) * blend;
        if (Math.hypot(camera.goal.x - camera.x, camera.goal.y - camera.y) < 0.5) camera.goal = null;
      }
      drawFrame();
    }

    function centerOn(id) {
      if (!layout[id]) return;
      camera.goal = null;
      camera.x = layout[id].x - viewport.clientWidth / (2 * camera.scale);
      camera.y = layout[id].y - viewport.clientHeight / (2 * camera.scale);
      drawFrame();
    }

    function glideTo(ids) {
      const targets = organic.createOrganicLayout(graph, { width: worldWidth, height: worldHeight, existing: layout });
      const points = ids.map((id) => targets[id]).filter(Boolean);
      if (!points.length) return;
      const visible = points.every((point) => {
        const x = (point.x - camera.x) * camera.scale;
        const y = (point.y - camera.y) * camera.scale;
        return x > 110 && x < viewport.clientWidth - 110 && y > 100 && y < viewport.clientHeight - 100;
      });
      if (visible) return;
      const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
      const goal = {
        x: center.x - viewport.clientWidth / (2 * camera.scale),
        y: center.y - viewport.clientHeight / (2 * camera.scale),
      };
      if (motionQuery.matches) {
        camera.x = goal.x;
        camera.y = goal.y;
        camera.goal = null;
        drawFrame();
      } else {
        camera.goal = goal;
      }
    }

    function updateSelectedClasses() {
      focusModel = SJ.graphKeywords.computeGraphKeywords(graph, {
        focusId: selectedId,
        exploration: focusPreferences.exploration,
        count: 3,
      });
      const path = focusModel.path;
      const pathSet = new Set(path);
      const pathEdges = new Set(path.slice(1).map((id, index) => [path[index], id].sort().join('|')));
      const keywordIds = new Set(focusModel.keywords.map((item) => item.id));
      nodesLayer.querySelectorAll('[data-map-node]').forEach((element) => {
        const id = element.getAttribute('data-map-node');
        const node = nodeById(id);
        const selected = id === selectedId;
        const inPath = pathSet.has(id);
        const isKeyword = node && Array.from(keywordIds).some((keyword) => SJ.graphKeywords.tokenize(node.text).includes(keyword));
        element.classList.toggle('is-selected', selected);
        element.classList.toggle('is-focus-path', inPath);
        element.classList.toggle('is-context', !inPath);
        element.classList.toggle('is-keyword', Boolean(isKeyword));
        element.classList.toggle('is-expanding', busy && selected);
        element.querySelector('button').setAttribute('aria-pressed', String(selected));
        const label = selected || inPath ? node.text : node.text.length > 18 ? node.text.slice(0, 18) + '…' : node.text;
        element.querySelector('strong').textContent = label;
      });
      edgesLayer.querySelectorAll('[data-edge-id]').forEach((element) => {
        const edge = graph.edges.find((item) => item.id === element.getAttribute('data-edge-id'));
        const focused = edge && pathEdges.has([edge.from, edge.to].sort().join('|'));
        element.classList.toggle('is-focus-path', Boolean(focused));
        element.classList.toggle('is-context', !focused);
      });

    }

    function renderGraph() {
      const visibleNodes = graph.nodes.filter((node) => layout[node.id]);
      const birthOrder = new Map(Array.from(newborn).map((id, index) => [id, index]));
      nodesLayer.innerHTML = visibleNodes.map((node) => {
        const kind = graphApi.KINDS[node.kind] || graphApi.KINDS.concept;
        const state = node.status === 'candidate' ? ' is-candidate' : node.status === 'accepted' ? ' is-accepted' : '';
        const born = newborn.has(node.id) ? ' is-newborn' : '';
        const delay = birthOrder.has(node.id) ? ` style="--birth-delay:${birthOrder.get(node.id) * 90}ms"` : '';
        return `<article class="thought-map-node${state}${born}" data-map-node="${u.esc(node.id)}" data-kind="${u.esc(node.kind)}"${delay}>
          <button type="button" data-select-node="${u.esc(node.id)}" aria-pressed="${node.id === selectedId}" aria-label="${u.esc(kind.label + '：' + node.text + '。' + originLabel(node))}">
            <span class="thought-node-orbit" aria-hidden="true"></span>
            <span class="thought-node-kind">${u.esc(kind.label)}</span>
            <strong>${u.esc(node.text)}</strong>
            <span class="thought-node-origin">${u.esc(originLabel(node))}</span>
          </button>
        </article>`;
      }).join('');
      edgesLayer.innerHTML = visibleEdges().map((edge) => {
        const relation = edge.type === 'source' ? '原话' : edge.type === 'cooccurrence' ? '同现' : graphApi.ACTIONS[edge.type] ? graphApi.ACTIONS[edge.type].relation : '关联';
        const born = newborn.has(edge.to) ? ' is-newborn' : '';
        const delay = birthOrder.has(edge.to) ? ` style="--birth-delay:${birthOrder.get(edge.to) * 90}ms"` : '';
        return `<g class="thought-map-edge is-${u.esc(edge.status)} is-${u.esc(edge.type)}${born}" data-edge-id="${u.esc(edge.id)}"${delay}><path /><text text-anchor="middle">${u.esc(relation)}</text></g>`;
      }).join('');
      updateSelectedClasses();
      drawFrame();
      newborn.clear();
    }

    function renderInspector() {
      updateSelectedClasses();
    }

    function closeMenu() {
      menu.hidden = true;
      menuNodeId = null;
    }

    function closeDrawer() {
      drawer.hidden = true;
    }

    function openDrawer(content, label) {
      drawer.innerHTML = `<div class="thought-drawer-heading"><strong>${u.esc(label)}</strong><button type="button" data-close-drawer aria-label="收起面板">×</button></div>${content}`;
      drawer.hidden = false;
    }

    function openSource() {
      const node = nodeById(selectedId);
      const quote = node && node.sourceQuote ? node.sourceQuote : session && session.original ? session.original.text : '';
      openDrawer(quote ? `<blockquote class="thought-source-quote">${u.esc(quote)}</blockquote><p>原话只读，AI 扩展不会覆盖它。</p>` : '<p>没有可确认的原始引文，保留来源不确定性。</p>', '完整原话');
    }

    function rejectedHTML() {
      const rejected = graph.nodes.filter((node) => node.status === 'rejected');
      return rejected.length ? `<section class="thought-rejected"><h3>已拒绝路径 · ${rejected.length}</h3>${rejected.map((node) => `<div class="thought-rejected-item"><span>${u.esc(node.text)}</span><button type="button" data-restore-node="${u.esc(node.id)}">恢复</button></div>`).join('')}</section>` : '';
    }

    function openPreferences() {
      const boundary = SJ.graphExpansion.boundaryState(graph, preferences);
      const content = `
        <p>只影响本次候选排序与规模，不建立人格画像。</p>
        <p class="thought-preference-summary">${u.esc(preferenceApi.preferenceSummary(preferences))}</p>
        <div data-preference-controls>
        <label class="thought-preference-select">边界扩张总率上限<select data-pref-boundary>${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${preferences.boundaryTarget === value ? 'selected' : ''}>${value * 100}%</option>`).join('')}</select></label>
        <p>当前 ${Math.round(boundary.rate * 100)}% · 还可扩展 ${boundary.remaining} 条。待确认候选会预留额度，拒绝后释放。</p>
        ${Object.keys(graphApi.ACTIONS).map((key) => `<label class="thought-preference-range"><span>${u.esc(graphApi.ACTIONS[key].label)}<output>${Math.round(preferences.weights[key] * 100)}</output></span><input type="range" min="0.05" max="0.95" step="0.05" value="${preferences.weights[key]}" data-pref-weight="${key}" aria-label="${u.esc(graphApi.ACTIONS[key].label)}偏好"></label>`).join('')}
        <label class="thought-preference-select">表达偏好<select data-pref-style><option value="balanced" ${preferences.style === 'balanced' ? 'selected' : ''}>具体与抽象均衡</option><option value="concrete" ${preferences.style === 'concrete' ? 'selected' : ''}>优先具体路径</option><option value="abstract" ${preferences.style === 'abstract' ? 'selected' : ''}>优先抽象路径</option></select></label>
        <label class="thought-preference-select">每次扩展<select data-pref-count>${[0, 1, 2, 3].map((count) => `<option value="${count}" ${preferences.count === count ? 'selected' : ''}>${count === 0 ? '暂停扩展' : count + ' 条'}</option>`).join('')}</select></label>
        </div>
        <button type="button" class="thought-text-button" data-reset-preferences>重置本次偏好</button>${rejectedHTML()}`;
      openDrawer(content, '扩展偏好');
    }

    function openEditor() {
      const node = nodeById(selectedId);
      if (!node || node.sourceOrigin !== 'ai') return;
      openDrawer(`<form data-node-edit-form class="thought-node-edit-form"><label>修改候选文字<textarea data-node-edit-input maxlength="160" rows="4">${u.esc(node.text)}</textarea></label><button type="submit" class="thought-primary-button">保存并接受</button></form>`, '修改候选');
      const input = drawer.querySelector('[data-node-edit-input]');
      input.focus();
      input.select();
    }

    function openMenu(nodeId, clientX, clientY) {
      const node = nodeById(nodeId);
      if (!node) return;
      const actions = graphApi.allowedActions(node.kind);
      menuNodeId = nodeId;
      const candidateActions = node.sourceOrigin === 'ai' ? `
        ${node.status === 'candidate' ? '<button type="button" role="menuitem" data-menu-command="accept"><strong>接受候选</strong></button><button type="button" role="menuitem" data-menu-command="edit"><strong>修改后接受</strong></button><button type="button" role="menuitem" data-menu-command="reject"><strong>拒绝候选</strong></button>' : ''}
        ${node.status === 'accepted' ? '<button type="button" role="menuitem" data-menu-command="reject"><strong>改为拒绝</strong></button>' : ''}
        ${node.status === 'rejected' ? '<button type="button" role="menuitem" data-menu-command="restore"><strong>恢复为候选</strong></button>' : ''}` : '';
      menu.innerHTML = `<p>${u.esc(node.text)}</p>${actions.map((action) => `<button type="button" role="menuitem" data-menu-action="${action.id}"><strong>${u.esc(action.label)}</strong><span>${u.esc(action.description)}</span></button>`).join('')}${candidateActions}<div class="thought-menu-secondary"><button type="button" role="menuitem" data-menu-command="source">查看原话</button><button type="button" role="menuitem" data-menu-command="preferences">扩展偏好</button></div>`;
      menu.hidden = false;
      const width = Math.min(292, window.innerWidth - 24);
      const height = Math.min(440, actions.length * 68 + 140);
      menu.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, clientX)) + 'px';
      menu.style.top = Math.max(12, Math.min(window.innerHeight - height - 12, clientY)) + 'px';
      const first = menu.querySelector('button');
      if (first) first.focus();
    }

    async function expandNode(nodeId, action) {
      const node = nodeById(nodeId);
      if (!node || busy) return;
      closeMenu();
      closeDrawer();
      selectedId = nodeId;
      const capacity = SJ.graphExpansion.remainingCapacity(graph, preferences);
      if (preferences.count === 0 || capacity === 0) {
        renderInspector();
        announce(preferences.count === 0 ? '扩展已暂停，现有网络没有改变' : '已到边界扩张总率上限，可提高上限或拒绝一条候选来释放额度');
        return;
      }
      busy = true;
      renderInspector();
      announce('正在生成可拒绝的候选路径');
      try {
        const result = await SJ.expansionService.expand({
          node: { text: node.text, kind: node.kind, sourceQuote: node.sourceQuote },
          action,
          count: Math.min(3, capacity),
          preferences,
          exploration: focusPreferences.exploration,
          existingCandidates: graph.nodes.map((item) => ({ text: item.text, sourceOrigin: item.sourceOrigin, status: item.status })),
          context: { original: session && session.original ? session.original.text : '' },
        });
        const selection = SJ.graphExpansion.select(graph, nodeId, result.candidates, {
          action,
          count: preferences.count,
          preferences,
          exploration: focusPreferences.exploration,
        });
        const actualMode = result.meta && result.meta.actualMode === 'api' ? 'api' : 'demo';
        const addition = graphApi.addExpansion(graph, nodeId, action, selection.candidates, { actualMode, timestamp: Date.now() });
        graph = addition.graph;
        const upstreamSkipped = Array.isArray(result.skippedDuplicates) ? result.skippedDuplicates.length : 0;
        graph.expansionStats.generated += Math.max(0, result.candidates.length - selection.candidates.length);
        graph.expansionStats.skippedDuplicates += upstreamSkipped + selection.duplicates.length;
        addition.addedIds.forEach((id) => newborn.add(id));
        if (addition.addedIds.length) selectedId = addition.addedIds[0];
        syncLayout({ enteringIds: addition.addedIds, animate: autoFlow && !motionQuery.matches });
        persist();
        renderGraph();
        if (addition.addedIds.length) glideTo([nodeId].concat(addition.addedIds));
        announce(addition.addedIds.length ? '已生成 ' + addition.addedIds.length + ' 条候选，由你决定接受、修改或拒绝' : addition.reason || selection.reason || result.reason || '当前没有生成候选');
      } catch (error) {
        announce(error.message || '扩展失败，现有网络未改变');
      } finally {
        busy = false;
        renderInspector();
        if (additionHasNodes()) drawFrame();
      }
    }

    function additionHasNodes() {
      return Boolean(selectedId && layout[selectedId]);
    }

    function changeCandidateStatus(id, nextStatus) {
      const node = nodeById(id);
      if (!node || node.sourceOrigin !== 'ai') return;
      const previous = node.status;
      graph = graphApi.setCandidateStatus(graph, id, nextStatus);
      if ((nextStatus === 'accepted' || nextStatus === 'rejected') && previous !== nextStatus) {
        preferences = preferenceApi.applyFeedback(preferences, node, nextStatus === 'accepted');
      }
      selectedId = id;
      syncLayout();
      persist();
      renderGraph();
      renderInspector();
      if (!drawer.hidden) openPreferences();
      announce(nextStatus === 'accepted' ? '已接受路径，AI 来源仍保留' : nextStatus === 'rejected' ? '已拒绝，可在偏好面板恢复' : '已恢复为候选');
    }

    function close() {
      if (disposed) return;
      persist();
      disposed = true;
      window.cancelAnimationFrame(frameId);
      motionQuery.removeEventListener('change', onMotionChange);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    }

    function zoom(factor, clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      const x = clientX == null ? rect.width / 2 : clientX - rect.left;
      const y = clientY == null ? rect.height / 2 : clientY - rect.top;
      const next = Math.max(0.45, Math.min(1.8, camera.scale * factor));
      const worldX = camera.x + x / camera.scale;
      const worldY = camera.y + y / camera.scale;
      camera.scale = next;
      camera.x = worldX - x / next;
      camera.y = worldY - y / next;
      drawFrame();
    }

    overlay.addEventListener('click', (event) => {
      const keyword = event.target.closest('[data-keyword]');
      if (keyword && focusModel) {
        const token = keyword.getAttribute('data-keyword');
        const match = focusModel.nodes.find((node) => node.tokens.includes(token) || (nodeById(node.id) && SJ.graphKeywords.tokenize(nodeById(node.id).sourceQuote).includes(token)));
        if (match) {
          selectedId = match.id;
          closeMenu();
          renderInspector();
        }
        return;
      }
      const pathNode = event.target.closest('[data-path-node]');
      if (pathNode) {
        selectedId = pathNode.getAttribute('data-path-node');
        closeMenu();
        renderInspector();
        return;
      }
      const select = event.target.closest('[data-select-node]');
      if (select) {
        if (suppressNodeClick) { suppressNodeClick = false; return; }
        selectedId = select.getAttribute('data-select-node');
        closeMenu();
        renderInspector();
        return;
      }
      const action = event.target.closest('[data-menu-action]');
      if (action) { expandNode(menuNodeId, action.getAttribute('data-menu-action')); return; }
      const command = event.target.closest('[data-menu-command]');
      if (command) {
        const value = command.getAttribute('data-menu-command');
        selectedId = menuNodeId;
        closeMenu();
        if (value === 'source') openSource();
        else if (value === 'preferences') openPreferences();
        else if (value === 'accept') changeCandidateStatus(selectedId, 'accepted');
        else if (value === 'reject') changeCandidateStatus(selectedId, 'rejected');
        else if (value === 'restore') changeCandidateStatus(selectedId, 'candidate');
        else if (value === 'edit') openEditor();
        return;
      }
      if (event.target.closest('[data-map-close]')) { close(); return; }
      if (event.target.closest('[data-open-expand]')) {
        const rect = event.target.closest('[data-open-expand]').getBoundingClientRect();
        openMenu(selectedId, rect.left, rect.bottom + 6);
        return;
      }
      if (event.target.closest('[data-open-source]')) { closeMenu(); openSource(); return; }
      if (event.target.closest('[data-open-preferences]')) { closeMenu(); openPreferences(); return; }
      if (event.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
      if (event.target.closest('[data-accept-node]')) { changeCandidateStatus(selectedId, 'accepted'); return; }
      if (event.target.closest('[data-reject-node]')) { changeCandidateStatus(selectedId, 'rejected'); return; }
      if (event.target.closest('[data-restore-selected]')) { changeCandidateStatus(selectedId, 'candidate'); return; }
      if (event.target.closest('[data-edit-node]')) { openEditor(); return; }
      const restore = event.target.closest('[data-restore-node]');
      if (restore) { changeCandidateStatus(restore.getAttribute('data-restore-node'), 'candidate'); return; }
      if (event.target.closest('[data-reset-preferences]')) {
        preferences = preferenceApi.resetPreferences();
        persist();
        openPreferences();
        announce('本次扩展偏好已重置');
        return;
      }
      const zoomButton = event.target.closest('[data-zoom]');
      if (zoomButton) {
        const action = zoomButton.getAttribute('data-zoom');
        if (action === 'reset') centerOn(graph.rootId);
        else zoom(action === 'in' ? 1.18 : 1 / 1.18);
        return;
      }
      if (!event.target.closest('[data-context-menu]')) closeMenu();
    });

    overlay.addEventListener('contextmenu', (event) => {
      const element = event.target.closest('[data-map-node]');
      if (!element) return;
      event.preventDefault();
      selectedId = element.getAttribute('data-map-node');
      renderInspector();
      openMenu(selectedId, event.clientX, event.clientY);
    });

    overlay.addEventListener('submit', (event) => {
      if (!event.target.matches('[data-node-edit-form]')) return;
      event.preventDefault();
      const node = nodeById(selectedId);
      const value = event.target.querySelector('[data-node-edit-input]').value;
      if (!node || !value.trim()) return;
      const wasCandidate = node.status === 'candidate';
      graph = graphApi.editGraphNode(graph, selectedId, value);
      graph = graphApi.setCandidateStatus(graph, selectedId, 'accepted');
      if (wasCandidate) preferences = preferenceApi.applyFeedback(preferences, Object.assign({}, node, { text: value.trim() }), true);
      persist();
      closeDrawer();
      renderGraph();
      renderInspector();
      announce('修改已接受，原始表达未改变');
    });

    overlay.addEventListener('input', (event) => {
      if (event.target.matches('[data-exploration]')) {
        focusPreferences = SJ.graphKeywords.createFocusPreferences({ exploration: event.target.value });
        event.target.parentElement.querySelector('output').textContent = Math.round(focusPreferences.exploration * 100);
        updateSelectedClasses();
        persist();
      }
      if (event.target.matches('[data-pref-weight]')) {
        const key = event.target.getAttribute('data-pref-weight');
        preferences = preferenceApi.updatePreference(preferences, key, event.target.value);
        event.target.previousElementSibling.querySelector('output').textContent = Math.round(preferences.weights[key] * 100);
        drawer.querySelector('.thought-preference-summary').textContent = preferenceApi.preferenceSummary(preferences);
        persist();
      }
      if (event.target.matches('[data-pref-style]')) { preferences = preferenceApi.updatePreference(preferences, 'style', event.target.value); persist(); openPreferences(); }
      if (event.target.matches('[data-pref-count]')) { preferences = preferenceApi.updatePreference(preferences, 'count', Number(event.target.value)); persist(); openPreferences(); }
      if (event.target.matches('[data-pref-boundary]')) { preferences = preferenceApi.updatePreference(preferences, 'boundaryTarget', Number(event.target.value)); persist(); openPreferences(); announce('边界扩张总率上限已调整为 ' + preferences.boundaryTarget * 100 + '%'); }
      if (event.target.matches('[data-auto-flow]')) autoFlow = event.target.checked && !motionQuery.matches;
    });

    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      camera.goal = null;
      zoom(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      camera.goal = null;
      const nodeElement = event.target.closest('[data-map-node]');
      const rect = viewport.getBoundingClientRect();
      dragging = {
        pointerId: event.pointerId,
        nodeId: nodeElement ? nodeElement.getAttribute('data-map-node') : null,
        startX: event.clientX,
        startY: event.clientY,
        cameraX: camera.x,
        cameraY: camera.y,
        moved: false,
        rect,
      };
      if (nodeElement) {
        selectedId = dragging.nodeId;
        renderInspector();
        dragging.longPressed = false;
        dragging.longPressTimer = window.setTimeout(() => {
          if (!dragging || dragging.moved) return;
          dragging.longPressed = true;
          suppressNodeClick = true;
          const nodeRect = nodeElement.getBoundingClientRect();
          openMenu(dragging.nodeId, nodeRect.right, nodeRect.top);
        }, 650);
      }
      try { viewport.setPointerCapture(event.pointerId); } catch (error) { void error; }
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
      if (distance > 5) {
        dragging.moved = true;
        window.clearTimeout(dragging.longPressTimer);
      }
      if (!dragging.moved) return;
      if (dragging.nodeId && layout[dragging.nodeId]) {
        layout[dragging.nodeId].x = camera.x + (event.clientX - dragging.rect.left) / camera.scale;
        layout[dragging.nodeId].y = camera.y + (event.clientY - dragging.rect.top) / camera.scale;
        layout[dragging.nodeId].vx = 0;
        layout[dragging.nodeId].vy = 0;
      } else {
        camera.x = dragging.cameraX - (event.clientX - dragging.startX) / camera.scale;
        camera.y = dragging.cameraY - (event.clientY - dragging.startY) / camera.scale;
      }
      drawFrame();
    });

    function finishPointer(event) {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      window.clearTimeout(dragging.longPressTimer);
      if (dragging.moved && dragging.nodeId) {
        suppressNodeClick = true;
        persist();
      }
      if (dragging.longPressed) suppressNodeClick = true;
      dragging = null;
    }

    viewport.addEventListener('pointerup', finishPointer);
    viewport.addEventListener('pointercancel', finishPointer);

    function onMotionChange() {
      if (motionQuery.matches) autoFlow = false;
    }

    function onDocumentKeydown(event) {
      if (!overlay.isConnected) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!menu.hidden) closeMenu();
        else if (!drawer.hidden) closeDrawer();
        else close();
        return;
      }
      if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
        const element = nodesLayer.querySelector('[data-map-node="' + CSS.escape(selectedId) + '"]');
        if (element) {
          event.preventDefault();
          const rect = element.getBoundingClientRect();
          openMenu(selectedId, rect.right, rect.top);
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((element) => element.getClientRects().length && !element.closest('[hidden]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    syncLayout();
    renderGraph();
    renderInspector();
    document.addEventListener('keydown', onDocumentKeydown, true);
    motionQuery.addEventListener('change', onMotionChange);
    centerOn(graph.rootId);
    overlay.querySelector('[data-map-close]').focus();
    frameId = window.requestAnimationFrame(frame);
    return { close, getGraph: () => graph };
  }

  SJ.thoughtMapView = { open: openThoughtMap };
})();
