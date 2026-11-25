(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  function userTexts(session) {
    if (!session) return [];
    const answers = (session.rounds || []).map((round) => round.answer && round.answer.text);
    const branches = (session.branches || []).map((branch) => branch.text);
    const confirmed = session.confirmed && session.confirmed.text ? [session.confirmed.text] : [];
    return [session.original && session.original.text].concat(answers, branches, confirmed).filter((text) => text && text.trim());
  }

  SJ.views.lightfield = function (main, session) {
    const core = SJ.lightField;
    const corpus = SJ.lightFieldCorpus;
    const dragApi = SJ.lightFieldDrag;
    const natural = SJ.lightFieldNatural;
    const soap = SJ.lightFieldSoap;
    const stars = SJ.lightFieldStars;
    const thoughts = SJ.lightFieldThoughts;
    const messages = userTexts(session);
    const thoughtEdits = session && session.lightThoughts && !Array.isArray(session.lightThoughts) ? session.lightThoughts : {};
    const rawText = messages.join('\n');
    const extracted = SJ.thoughtSegments.extractThoughtSegments(rawText, 48);
    const editedKeywords = Object.values(thoughtEdits).map((edit) => edit.keyword).filter(Boolean);
    const candidates = core.keywordPool(core.dedupeKeywords(extracted.concat(editedKeywords)));
    const frequencyRows = corpus.corpusFrequencies(messages, candidates);
    const frequencyMap = new Map(frequencyRows.map((row) => [row.text, row]));
    const mobile = window.innerWidth <= 640;
    const sizeConfig = corpus.responsiveSizeConfig(window.innerWidth);
    const centralText = candidates[0];
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let motion = core.getMotionOptions(motionQuery.matches);
    let bubbles = core.createInitialBubbles(candidates, { width: window.innerWidth }).map(decorateBubble);
    bubbles.forEach((bubble) => {
      const edit = thoughtEdits[bubble.id];
      if (edit) {
        bubble.text = edit.keyword;
        bubble.note = edit.note;
        bubble.edited = true;
      }
      if (!bubble.current) bubble.group = bubble.coherence >= 0.55 ? 0 : core.classifyKeyword(bubble.text) === 'function' ? 2 : core.classifyKeyword(bubble.text) === 'direction' ? 3 : 1;
    });
    const currentBubble = bubbles.find((bubble) => bubble.current);
    if (currentBubble) {
      currentBubble.x = 50;
      currentBubble.y = 50;
    }
    let buttons = [];
    let corpusBox = [];
    let candidateCursor = bubbles.length % candidates.length;
    let nextBubbleSerial = 1;
    let selectedId = null;
    let pointerPress = null;
    let spacePress = null;
    let stageDrag = null;
    let stagePulseTimer = null;
    let lastInertiaFrame = 0;
    let colorFrameId = 0;
    let lastColorFrame = 0;
    let disposed = false;
    const fieldPointer = { x: 0.5, y: 0.5, energy: 0 };
    const glowTimers = new Map();
    const candidateLabel = session && session.demoPublicCase ? 'DeliData 公开会话候选池' : session ? '当前用户语料候选池，必要时含演示补充词' : '演示候选词';

    let sourceText = '当前没有思考记录，显示演示短句。';
    if (session && session.demoPublicCase) {
      sourceText = '数据来自 DeliData 公开研究会话，共 15 条英文发言，发言人及顺序保留。来源：' + (session.publicSource && session.publicSource.url) + '。这是只读演示，不写入历史记录。';
    } else if (session && extracted.length) {
      sourceText = '星点短句由本地规则从最近一次思考的原始表达、各轮回答、新方向分支和已确认问题中截取，不包含 AI 生成内容；主持、同意和礼貌用语不单独成星。气泡大小只表示短句在当前用户语料中的相对出现频次。';
      if (extracted.length === 1) sourceText += '候选短句较少，补充了一个演示短句用于轮换。';
    } else if (session) {
      sourceText = '最近记录中暂时没有可截取的短句，显示演示短句。';
    }

    function decorateBubble(bubble) {
      const frequency = frequencyMap.get(bubble.text) || { count: 0, probability: 0 };
      const baseRadius = corpus.sizeForProbability(frequency.probability, sizeConfig);
      const previousKeyword = bubble.previousKeyword || centralText;
      bubble.probability = frequency.probability;
      bubble.corpusCount = frequency.count;
      bubble.kind = bubble.kind || SJ.thoughtGraph.classifyThought(bubble.text, { final: bubble.current && session && session.confirmed });
      bubble.coherence = corpus.coherenceScore(bubble.text, { messages, candidates, previousKeyword });
      bubble.coherenceLabel = '启发式收束度 ' + Math.round(bubble.coherence * 100) + '%，基于同消息共现、词汇重叠、共现图连接、主题连续性和场上距离，不证明真实逻辑';
      bubble.radius = bubble.current
        ? Math.max(sizeConfig.currentMin, Math.min(sizeConfig.currentMax, baseRadius * 1.25))
        : baseRadius;
      bubble.size = bubble.radius * 2;
      bubble.depth = bubble.depth || 0;
      return bubble;
    }

    function frequencyLabel(bubble) {
      if (session && session.demoPublicCase) return '在 DeliData 公开会话中出现 ' + (bubble.corpusCount || 0) + ' 次，相对频次 ' + Math.round((bubble.probability || 0) * 100) + '%';
      if (!session) return '演示候选词，没有用户语料频次';
      return '在当前用户语料中出现 ' + (bubble.corpusCount || 0) + ' 次，相对频次 ' + Math.round((bubble.probability || 0) * 100) + '%';
    }

    function bubbleLabel(bubble) {
      const currentLabel = bubble.current ? '，当前想法' : '';
      return bubble.text + currentLabel + '，气泡。' + [bubble.relationLabel, bubble.coherenceLabel, frequencyLabel(bubble)].filter(Boolean).join('；');
    }

    function bubbleHTML(bubble, index) {
      const color = corpus.coherenceColor(core.bubbleColor(bubble.x / 100, bubble.y / 100, 12, core.classifyKeyword(bubble.text)), bubble.coherence);
      const star = stars.starShape(bubble.id);
      const rays = stars.starRays(bubble.id, 8).map((ray) => `<line x1="${ray.x1.toFixed(2)}" y1="${ray.y1.toFixed(2)}" x2="${ray.x2.toFixed(2)}" y2="${ray.y2.toFixed(2)}" style="opacity:${ray.opacity.toFixed(2)}" />`).join('');
      const style = [
        '--x:' + bubble.x + '%', '--y:' + bubble.y + '%', '--size:' + bubble.size + 'px',
        '--dx:' + bubble.driftX, '--dy:' + bubble.driftY,
        '--duration:' + bubble.duration + 's', '--delay:' + bubble.delay + 's',
        '--bubble-rgb:' + color.r + ',' + color.g + ',' + color.b,
        '--star-core-scale:' + star.coreScale.toFixed(2),
      ].join(';');
      const currentClass = bubble.current ? ' is-current' : '';
      const edgeClass = bubble.x > 76 ? ' is-right-edge' : bubble.x < 24 ? ' is-left-edge' : '';
      const title = [bubble.relationLabel, bubble.coherenceLabel, frequencyLabel(bubble)].filter(Boolean).join('；');
      return `<button type="button" class="light-bubble${currentClass}${edgeClass}" data-bubble-id="${bubble.id}" tabindex="${index === 0 ? '0' : '-1'}" aria-pressed="false" aria-grabbed="false" aria-describedby="light-field-instructions" aria-label="${u.esc(bubbleLabel(bubble))}" title="${u.esc(title)}" style="${style}"><span class="light-bubble-orb"><span class="light-star" aria-hidden="true"><span class="light-star-halo"></span><svg class="light-star-rays" viewBox="0 0 100 100">${rays}</svg><span class="light-star-core"></span></span><svg class="light-bubble-crack" viewBox="0 0 100 100" aria-hidden="true"><path d="M52 4 L47 28 L56 43 L41 61 L47 96 M47 28 L30 38 M56 43 L74 31 M41 61 L24 72 M47 76 L65 85" /></svg><span class="light-bubble-text">${u.esc(bubble.text)}</span></span></button>`;
    }

    main.innerHTML = `
      <section class="light-field-page" aria-labelledby="light-field-title">
        <h1 id="light-field-title" class="sr-only">光影</h1>
        <p id="light-field-instructions" class="sr-only">${u.esc(sourceText)}点击气泡打开以它为中心的局部思维导图，可查看完整原话、节点类型和关系，并按需生成可拒绝的 AI 候选路径。按住并拖动空白区域会沿轨迹生成涡流，单击空白不生成涡元。鼠标或触摸拖动超过 8 像素可移动气泡，松手有小幅惯性。长按约 650 毫秒分裂为 2 到 3 个共现词或候选词，父气泡进入左下角语料箱。方向键切换，Enter 打开导图，Shift 加 Enter 或长按空格分裂。双击或 Ctrl/⌘+Enter 编辑想法，悬浮查看详情，Escape 关闭导图、详情、语料箱或聚焦，没有聚焦时返回首页。</p>
        <div class="light-field-stage" data-light-stage role="group" aria-label="交互式想法星落">
          <canvas class="light-field-canvas" data-light-canvas aria-hidden="true"></canvas>
          <div class="light-center-glow" aria-hidden="true"></div>
          <svg class="soap-links" aria-hidden="true"><g data-soap-links></g></svg>
          ${bubbles.map(bubbleHTML).join('')}
        </div>
        <p class="light-field-hint" data-light-hint>拖动空白生成涡流 · 点击星点进入导图</p>
        <aside class="thought-detail" data-thought-detail hidden aria-live="polite"></aside>
        <section class="thought-editor" data-thought-editor hidden role="dialog" aria-modal="true" aria-label="编辑想法">
          <form data-thought-form>
            <label>关键词<input type="text" data-edit-keyword maxlength="40" required></label>
            <label>补充一句想法<textarea data-edit-note maxlength="240" rows="3"></textarea></label>
            <div class="thought-editor-actions"><button type="submit" class="btn btn-primary btn-sm">保存想法</button><button type="button" class="btn btn-ghost btn-sm" data-edit-cancel>取消</button></div>
          </form>
        </section>
        <button type="button" class="corpus-box-button" data-corpus-box aria-label="语料箱，0 个气泡，点击查看" aria-expanded="false" aria-controls="corpus-panel" title="语料箱：父气泡与过小气泡"><span data-corpus-count>0</span><span class="sr-only">语料箱</span></button>
        <section id="corpus-panel" class="corpus-panel" data-corpus-panel aria-label="语料箱内容" hidden>
          <p class="corpus-panel-title">已装进气泡的文本</p>
          <div class="corpus-panel-list" data-corpus-list></div>
          <button type="button" class="corpus-panel-close" data-corpus-close>收起语料箱</button>
        </section>
        <button type="button" class="light-field-exit" data-light-exit aria-label="退出光影，回到首页"><span aria-hidden="true">×</span></button>
        <p class="sr-only" role="status" aria-live="polite" data-light-status></p>
      </section>`;

    const stage = main.querySelector('[data-light-stage]');
    const centerGlow = main.querySelector('.light-center-glow');
    const hint = main.querySelector('[data-light-hint]');
    const status = main.querySelector('[data-light-status]');
    const exitButton = main.querySelector('[data-light-exit]');
    const corpusButton = main.querySelector('[data-corpus-box]');
    const corpusPanel = main.querySelector('[data-corpus-panel]');
    const corpusList = main.querySelector('[data-corpus-list]');
    const colorField = SJ.lightFieldFluid.createFluidField(main.querySelector('[data-light-canvas]'), motionQuery);
    const detailPanel = main.querySelector('[data-thought-detail]');
    const editorPanel = main.querySelector('[data-thought-editor]');
    const editorForm = main.querySelector('[data-thought-form]');
    const keywordInput = main.querySelector('[data-edit-keyword]');
    const noteInput = main.querySelector('[data-edit-note]');
    let detailId = null;
    let detailPinned = false;
    let editingId = null;
    const hintTimer = window.setTimeout(() => {
      hint.classList.add('is-fading');
      window.setTimeout(() => { hint.hidden = true; }, motion.reducedMotion ? 0 : 1000);
    }, 4800);

    function showThoughtDetail(id, pinned) {
      const bubble = bubbleById(id);
      if (!bubble) return;
      const detail = thoughts.detailForBubble(bubble, { messages });
      const point = bubbleClientPoint(bubble);
      detailId = id;
      detailPinned = Boolean(pinned);
      detailPanel.innerHTML = `<p class="thought-detail-keyword">${u.esc(detail.keyword)}</p><p>来源原话：${u.esc(detail.source.snippet)}</p><p>相对频次：${Math.round(detail.probability * 100)}% · 启发式收束度：${Math.round(detail.coherence * 100)}%</p><p class="thought-detail-hint">${u.esc(detail.hint)}</p>${bubble.note ? `<p class="thought-detail-note">补充：${u.esc(bubble.note)}</p>` : ''}`;
      detailPanel.style.left = Math.max(12, Math.min(window.innerWidth - 270, point.x - 120)) + 'px';
      const detailTop = point.y < 220 ? point.y + 42 : point.y - 210;
      detailPanel.style.top = Math.max(12, Math.min(window.innerHeight - 200, detailTop)) + 'px';
      detailPanel.hidden = false;
    }

    function hideThoughtDetail(force) {
      if (!force && detailPinned) return;
      detailPanel.hidden = true;
      detailId = null;
      detailPinned = false;
    }

    function toggleThoughtDetail(id) {
      if (detailId === id && detailPinned) hideThoughtDetail(true);
      else showThoughtDetail(id, true);
    }

    function openThoughtEditor(id) {
      if (session && session.demoPublicCase) {
        announce('DeliData 公开案例只读，请在新思考中编辑自己的想法');
        return;
      }
      if (!session) {
        announce('暂无会话，无法保存编辑');
        return;
      }
      const bubble = bubbleById(id);
      if (!bubble) return;
      editingId = id;
      keywordInput.value = bubble.text;
      noteInput.value = bubble.note || '';
      editorPanel.hidden = false;
      hideThoughtDetail(true);
      keywordInput.focus();
      keywordInput.select();
    }

    function closeThoughtEditor() {
      editorPanel.hidden = true;
      editingId = null;
    }

    function bubbleById(id) {
      return bubbles.find((bubble) => bubble.id === id);
    }

    function buttonById(id) {
      return buttons.find((button) => button.getAttribute('data-bubble-id') === id);
    }

    function refreshBubble(bubble) {
      const button = buttonById(bubble.id);
      if (!button) return;
      button.style.setProperty('--x', bubble.x + '%');
      button.style.setProperty('--y', bubble.y + '%');
      button.style.setProperty('--size', bubble.size + 'px');
      button.classList.toggle('is-right-edge', bubble.x > 76);
      button.classList.toggle('is-left-edge', bubble.x < 24);
      button.setAttribute('aria-label', bubbleLabel(bubble));
      button.title = [bubble.relationLabel, bubble.coherenceLabel, frequencyLabel(bubble)].filter(Boolean).join('；');
      button.querySelector('.light-bubble-text').textContent = bubble.text;
    }

    function refreshAllBubbles() {
      bubbles.forEach(refreshBubble);
      updateBubbleColors(motion.reducedMotion ? 12 : performance.now() / 1000);
    }

    function syncButtons() {
      buttons = buttons.filter((button) => {
        if (bubbleById(button.getAttribute('data-bubble-id'))) return true;
        button.remove();
        return false;
      });
    }

    function appendBubble(bubble, arriving) {
      const template = document.createElement('template');
      template.innerHTML = bubbleHTML(bubble, buttons.length).trim();
      const button = template.content.firstElementChild;
      stage.appendChild(button);
      buttons.push(button);
      bindBubble(button);
      refreshBubble(bubble);
      if (arriving) {
        button.classList.add('is-arriving');
        window.setTimeout(() => button.classList.remove('is-arriving'), motion.reducedMotion ? 0 : 450);
      }
      return button;
    }

    function updateBubbleColors(timeSeconds) {
      bubbles.forEach((bubble) => {
        const button = buttonById(bubble.id);
        if (!button) return;
        const baseColor = core.bubbleColor(bubble.x / 100, bubble.y / 100, timeSeconds, core.classifyKeyword(bubble.text), fieldPointer);
        const aspect = window.innerWidth / window.innerHeight;
        const nearest = bubbles.reduce((distance, other) => {
          if (other.id === bubble.id) return distance;
          return Math.min(distance, Math.hypot((other.x - bubble.x) * aspect, other.y - bubble.y));
        }, 200);
        const displayCoherence = corpus.spatialCoherence(bubble.coherence, nearest);
        const color = corpus.coherenceColor(baseColor, displayCoherence);
        const film = soap.filmColor(core.classifyKeyword(bubble.text), timeSeconds, displayCoherence);
        button.style.setProperty('--bubble-rgb', color.r + ',' + color.g + ',' + color.b);
        button.style.setProperty('--film-hue', film.h + 'deg');
        button.style.setProperty('--film-saturation', film.s + '%');
        button.style.setProperty('--film-lightness', film.l + '%');
        button.style.setProperty('--star-alpha', stars.starOpacity(bubble.id, timeSeconds, bubble.id === selectedId));
        button.dataset.textTone = core.textToneForBackground(color, { r: 18, g: 22, b: 34 }, 0.42);
      });
    }

    function updateGroupLinks(timeSeconds) {
      const threshold = mobile ? 48 : 52;
      const links = soap.groupLinks(bubbles, threshold);
      main.querySelector('[data-soap-links]').innerHTML = links.map((link) => {
        const first = bubbleById(link.a);
        const second = bubbleById(link.b);
        const style = stars.starLinkStyle(link.distance, timeSeconds, threshold);
        return `<line x1="${first.x}%" y1="${first.y}%" x2="${second.x}%" y2="${second.y}%" style="opacity:${style.opacity};stroke-width:${0.65 + link.strength * 0.35};stroke-dashoffset:${style.dashOffset}" />`;
      }).join('');
    }

    function updateBubbleMotion(timeSeconds) {
      if (pointerPress) {
        const progress = natural.crackProgress(timeSeconds * 1000 - pointerPress.startedAt, motion.reducedMotion);
        pointerPress.button.style.setProperty('--crack-opacity', String(progress * 0.82));
        pointerPress.button.style.setProperty('--crack-offset', (140 * (1 - progress)) + 'px');
      }
      let completedBirth = false;
      bubbles.forEach((bubble) => {
        const button = buttonById(bubble.id);
        if (!button) return;
        const groupMovement = stars.starFallTrajectory(bubble.group, timeSeconds);
        const movement = corpus.motionForBubble({ id: bubble.id, category: core.classifyKeyword(bubble.text) }, timeSeconds, motion.reducedMotion);
        movement.x += groupMovement.x;
        movement.y += groupMovement.y;
        let birthX = 0;
        let birthY = 0;
        if (bubble.birth) {
          const birthMotion = stars.starburstMotion(bubble.birth, timeSeconds - bubble.birth.start / 1000, motion.reducedMotion);
          birthX = birthMotion.x;
          birthY = birthMotion.y;
          button.style.setProperty('--birth-rotation', birthMotion.rotation + 'deg');
          button.style.setProperty('--birth-opacity', String(birthMotion.opacity));
          button.style.setProperty('--birth-scale', String(birthMotion.scale));
          if (birthMotion.done) {
            delete bubble.birth;
            button.classList.remove('is-newborn');
            button.style.removeProperty('--birth-rotation');
            button.style.removeProperty('--birth-opacity');
            button.style.removeProperty('--birth-scale');
            completedBirth = true;
          }
        }
        button.style.setProperty('--move-x', movement.x + birthX + 'px');
        button.style.setProperty('--move-y', movement.y + birthY + 'px');
      });
      updateGroupLinks(timeSeconds);
      if (completedBirth) applyLayout();
    }

    function colorFrame(now) {
      if (disposed || motion.reducedMotion) {
        colorFrameId = 0;
        return;
      }
      colorFrameId = window.requestAnimationFrame(colorFrame);
      updateInertia(now);
      if (now - lastColorFrame < 80) return;
      lastColorFrame = now;
      updateBubbleColors(now / 1000);
      updateBubbleMotion(now / 1000);
    }

    function startColorFrames() {
      window.cancelAnimationFrame(colorFrameId);
      colorFrameId = 0;
      lastColorFrame = 0;
      updateBubbleColors(motion.reducedMotion ? 12 : performance.now() / 1000);
      updateBubbleMotion(performance.now() / 1000);
      if (!motion.reducedMotion) colorFrameId = window.requestAnimationFrame(colorFrame);
    }

    function selectBubble(id) {
      if (!bubbleById(id)) return;
      selectedId = id;
      stage.classList.add('has-selection');
      colorField.setFocus(1);
      buttons.forEach((button) => {
        const selected = button.getAttribute('data-bubble-id') === id;
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }

    function clearSelection() {
      selectedId = null;
      stage.classList.remove('has-selection');
      colorField.setFocus(0);
      buttons.forEach((button) => {
        button.classList.remove('is-selected');
        button.setAttribute('aria-pressed', 'false');
      });
    }

    function announce(text) {
      status.textContent = '';
      window.setTimeout(() => { status.textContent = text; }, 20);
    }

    function updateCorpusUI() {
      const count = corpusBox.length;
      main.querySelector('[data-corpus-count]').textContent = String(count);
      corpusButton.setAttribute('aria-label', '语料箱，' + count + ' 个气泡，点击查看');
      corpusList.innerHTML = count
        ? corpusBox.map((bubble) => `<button type="button" class="corpus-restore" data-restore-id="${bubble.id}"><span>${u.esc(bubble.text)}</span><span>恢复到场上</span></button>`).join('')
        : '<p class="corpus-empty">语料箱还是空的。</p>';
      corpusList.querySelectorAll('[data-restore-id]').forEach((button) => {
        button.addEventListener('click', () => restoreBubble(button.getAttribute('data-restore-id')));
      });
    }

    function archiveEntries(entries, reason) {
      if (!entries.length) return;
      entries.forEach((entry) => {
        entry.archivedReason = reason || entry.archivedReason;
        corpusBox = corpus.archiveBubble(corpusBox, entry);
      });
      if (selectedId && entries.some((entry) => entry.id === selectedId)) clearSelection();
      updateCorpusUI();
    }

    function limitActiveBubbles() {
      const capacity = mobile ? 16 : 24;
      const overflow = [];
      while (bubbles.length > capacity) {
        const candidatesToArchive = bubbles.filter((bubble) => bubble.id !== selectedId && !bubble.current);
        const entry = candidatesToArchive.sort((a, b) => b.depth - a.depth || a.radius - b.radius)[0];
        if (!entry) break;
        overflow.push(entry);
        bubbles = bubbles.filter((bubble) => bubble.id !== entry.id);
      }
      archiveEntries(overflow, 'capacity');
    }

    function applyLayout() {
      bubbles = corpus.constrainLayout(bubbles, { width: window.innerWidth, height: window.innerHeight, padding: 12 });
      syncButtons();
      refreshAllBubbles();
    }

    function restoreBubble(id) {
      const restored = corpus.restoreFromBox(corpusBox, id);
      if (!restored.bubble) return;
      corpusBox = restored.box;
      const bubble = decorateBubble(restored.bubble);
      if (bubbleById(bubble.id)) bubble.id = 'light-restored-' + nextBubbleSerial++;
      bubble.radius = Math.max(mobile ? 12 : 14, bubble.radius || 16);
      bubble.size = bubble.radius * 2;
      bubble.x = mobile ? 35 : 28;
      bubble.y = 68;
      bubbles.push(bubble);
      limitActiveBubbles();
      applyLayout();
      updateCorpusUI();
      if (bubbleById(bubble.id)) {
        appendBubble(bubble, true);
        selectBubble(bubble.id);
        announce('已恢复「' + bubble.text + '」，可继续点击或分裂');
      }
    }

    function resizeOnClick(id) {
      const result = corpus.clickResize(bubbles, id, {
        minRadius: mobile ? 10 : 12,
        maxRadius: bubbleById(id) && bubbleById(id).current ? sizeConfig.currentMax : sizeConfig.clickMaxRadius,
        width: window.innerWidth,
        height: window.innerHeight,
        padding: 12,
      });
      bubbles = result.bubbles;
      archiveEntries(result.archived, 'too-small');
      applyLayout();
    }

    function bubbleClientPoint(bubble) {
      return { x: bubble.x * window.innerWidth / 100, y: bubble.y * window.innerHeight / 100 };
    }

    function openMap(id) {
      const bubble = bubbleById(id);
      if (!bubble || bubble.bursting) return;
      selectBubble(id);
      hideThoughtDetail(true);
      colorField.pulseNormalized(bubble.x / 100, bubble.y / 100, 0.65);
      if (main._thoughtMap) main._thoughtMap.close();
      main._thoughtMap = SJ.thoughtMapView.open({
        bubble,
        bubbles,
        messages,
        session,
        onSave(patch) {
          if (!session) return;
          session.thoughtMaps = patch.thoughtMaps;
          session.expansionPreferences = patch.expansionPreferences;
          session.focusPreferences = patch.focusPreferences;
          if (!session.demoPublicCase) SJ.store.updateSession(session.id, patch);
        },
      });
      announce('已打开「' + bubble.text + '」的局部思维导图');
    }

    function glow(id) {
      resizeOnClick(id);
      const bubble = bubbleById(id);
      const button = buttonById(id);
      if (!bubble || !button || bubble.bursting) return;
      selectBubble(id);
      colorField.pulseNormalized(bubble.x / 100, bubble.y / 100, 0.9);
      window.clearTimeout(glowTimers.get(id));
      button.classList.remove('is-glowing');
      if (!motion.reducedMotion) void button.offsetWidth;
      button.classList.add('is-glowing');
      glowTimers.set(id, window.setTimeout(() => button.classList.remove('is-glowing'), motion.pulseDuration));
      window.clearTimeout(stagePulseTimer);
      stage.classList.remove('is-pulsing');
      centerGlow.style.left = bubble.x + '%';
      centerGlow.style.top = bubble.y + '%';
      if (!motion.reducedMotion) {
        void stage.offsetWidth;
        stage.classList.add('is-pulsing');
        stagePulseTimer = window.setTimeout(() => stage.classList.remove('is-pulsing'), motion.pulseDuration);
      }
      announce('「' + bubble.text + '」已发亮并增大');
      toggleThoughtDetail(id);
    }

    function makeParticles(bubble) {
      if (!motion.particleCount) return;
      const holder = document.createElement('span');
      holder.className = 'light-particles';
      holder.setAttribute('aria-hidden', 'true');
      holder.style.setProperty('--x', bubble.x + '%');
      holder.style.setProperty('--y', bubble.y + '%');
      holder.style.setProperty('--particle-rgb', buttonById(bubble.id).style.getPropertyValue('--bubble-rgb'));
      for (let i = 0; i < motion.particleCount; i++) {
        const particle = document.createElement('span');
        const angle = (Math.PI * 2 * i) / motion.particleCount;
        const distance = 24 + (i % 3) * 8;
        particle.className = 'light-particle';
        particle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
        particle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
        holder.appendChild(particle);
      }
      stage.appendChild(holder);
      window.setTimeout(() => holder.remove(), 650);
    }

    function splitCandidates(parent, count) {
      const pool = core.dedupeKeywords(candidates.concat(core.DEFAULT_KEYWORDS));
      const rotated = core.rotateKeywords(pool, candidateCursor);
      candidateCursor = (candidateCursor + count) % pool.length;
      const options = { exclude: [parent.text], candidateLabel };
      let result = corpus.splitCandidates(parent.text, messages, rotated, count, options);
      if (result.length < count) {
        const additional = corpus.splitCandidates(parent.text, messages, rotated, count, {
          exclude: [parent.text].concat(result.map((item) => item.text)),
          candidateLabel,
        });
        const used = new Set(result.map((item) => item.text));
        result = result.concat(additional.filter((item) => !used.has(item.text))).slice(0, count);
      }
      return result;
    }

    function burst(id) {
      const bubble = bubbleById(id);
      const button = buttonById(id);
      if (!bubble || !button || bubble.bursting) return;
      selectBubble(id);
      const parent = Object.assign({}, bubble);
      const childCount = corpus.splitCount(parent.text);
      const childCandidates = splitCandidates(parent, childCount);
      const birthSeed = Array.from(parent.text).reduce((sum, character) => sum + character.charCodeAt(0), 0) + nextBubbleSerial;
      const vectors = natural.burstVectors(birthSeed, childCount);
      bubble.bursting = true;
      colorField.pulseNormalized(bubble.x / 100, bubble.y / 100, 1.35);
      window.clearTimeout(glowTimers.get(id));
      button.classList.remove('is-glowing');
      button.classList.add('is-bursting');
      button.setAttribute('aria-disabled', 'true');

      window.setTimeout(() => {
        if (!button.isConnected) return;
        const children = childCandidates.map((candidate, index) => {
          const child = decorateBubble({
            id: 'light-child-' + nextBubbleSerial++,
            text: candidate.text,
            x: parent.x,
            y: parent.y,
            current: false,
            depth: parent.depth + 1,
            parentId: parent.id,
            group: parent.group,
            previousKeyword: parent.text,
            relationLabel: candidate.relationLabel,
            source: candidate.source,
            birth: Object.assign({ start: performance.now() }, vectors[index]),
            driftX: 3 + index,
            driftY: 4 + index,
            duration: 10 + index,
            delay: -index,
          });
          child.radius = Math.max(mobile ? 10 : 12, Math.min(child.radius, parent.radius * 0.62));
          child.size = child.radius * 2;
          return child;
        });
        bubbles = bubbles.filter((item) => item.id !== parent.id).concat(children);
        archiveEntries([parent], 'split');
        limitActiveBubbles();
        syncButtons();
        refreshAllBubbles();
        children.forEach((child) => {
          if (bubbleById(child.id)) appendBubble(child, false).classList.add('is-newborn');
        });
        updateBubbleMotion(performance.now() / 1000);
        const hasCooccurrence = childCandidates.some((candidate) => candidate.source === 'cooccurrence');
        announce('「' + parent.text + '」已分裂为 ' + children.length + ' 个气泡，父气泡已进入语料箱；' + (hasCooccurrence ? '子词包含同一用户消息共现词' : '子词来自候选来源'));
      }, motion.burstDuration);
    }

    function updateInertia(now) {
      const dt = lastInertiaFrame ? Math.min(0.05, (now - lastInertiaFrame) / 1000) : 1 / 60;
      let hadInertia = false;
      let active = false;
      bubbles.forEach((bubble) => {
        if (!bubble.inertia) return;
        hadInertia = true;
        const step = dragApi.inertiaStep(bubble, bubble.inertia, dt, { width: window.innerWidth, height: window.innerHeight });
        Object.assign(bubble, step.bubble);
        bubble.inertia = step.velocity;
        bubble.inertiaElapsed = (bubble.inertiaElapsed || 0) + dt;
        const speed = Math.hypot(step.velocity.x, step.velocity.y);
        if (speed < 3 || bubble.inertiaElapsed > 0.75) {
          delete bubble.inertia;
          delete bubble.inertiaElapsed;
        } else active = true;
        refreshBubble(bubble);
      });
      lastInertiaFrame = now;
      if (hadInertia && !active) {
        lastInertiaFrame = 0;
        applyLayout();
      }
    }

    function finishDrag(press) {
      const bubble = bubbleById(press.id);
      if (!bubble) return;
      bubble.dragging = false;
      press.button.classList.remove('is-dragging');
      press.button.setAttribute('aria-grabbed', 'false');
      const velocity = dragApi.releaseVelocity(press.velocityX, press.velocityY, motion.reducedMotion);
      if (!motion.reducedMotion && Math.hypot(velocity.x, velocity.y) > 0.5) {
        bubble.inertia = velocity;
        bubble.inertiaElapsed = 0;
        lastInertiaFrame = 0;
      } else {
        delete bubble.inertia;
        applyLayout();
      }
    }

    function cancelPointerPress() {
      if (!pointerPress) return;
      window.clearTimeout(pointerPress.timer);
      const bubble = bubbleById(pointerPress.id);
      if (bubble) {
        bubble.dragging = false;
        delete bubble.inertia;
      }
      pointerPress.button.classList.remove('is-pressing', 'is-dragging');
      pointerPress.button.style.removeProperty('--crack-opacity');
      pointerPress.button.style.removeProperty('--crack-offset');
      pointerPress.button.setAttribute('aria-grabbed', 'false');
      pointerPress = null;
    }

    function cancelSpacePress() {
      if (!spacePress) return;
      window.clearTimeout(spacePress.timer);
      spacePress.button.classList.remove('is-pressing');
      spacePress = null;
    }

    function updateProximity(clientX, clientY) {
      bubbles.forEach((bubble) => {
        const button = buttonById(bubble.id);
        if (!button) return;
        const dx = bubble.x * window.innerWidth / 100 - clientX;
        const dy = bubble.y * window.innerHeight / 100 - clientY;
        button.classList.toggle('is-near', Math.hypot(dx, dy) < 125);
      });
    }

    function onStagePointerMove(event) {
      fieldPointer.x = event.clientX / window.innerWidth;
      fieldPointer.y = event.clientY / window.innerHeight;
      fieldPointer.energy = event.pointerType === 'touch' ? 0.9 : 0.52;
      colorField.pointerMove(event.clientX, event.clientY, event.pointerType);
      if (stageDrag && stageDrag.pointerId === event.pointerId) {
        const distance = Math.hypot(event.clientX - stageDrag.x, event.clientY - stageDrag.y);
        if (distance > 6) stageDrag.active = true;
        const emittedDistance = Math.hypot(event.clientX - stageDrag.emitX, event.clientY - stageDrag.emitY);
        if (stageDrag.active && emittedDistance >= 36) {
          colorField.dragNormalized(event.clientX / window.innerWidth, event.clientY / window.innerHeight, 0.55);
          stageDrag.emitX = event.clientX;
          stageDrag.emitY = event.clientY;
        }
      }
      updateProximity(event.clientX, event.clientY);
      if (motion.reducedMotion) updateBubbleColors(12);
    }

    function onStagePointerDown(event) {
      fieldPointer.energy = 1.4;
      colorField.pointerDown(event.clientX, event.clientY);
      stageDrag = event.target.closest('[data-bubble-id]') ? null : {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        emitX: event.clientX,
        emitY: event.clientY,
        active: false,
      };
      if (motion.reducedMotion) updateBubbleColors(12);
    }

    function onStagePointerUp(event) {
      if (event.target.closest('[data-bubble-id]')) return;
      stageDrag = null;
      colorField.pointerUp(event.clientX, event.clientY, false, event.pointerType);
      clearSelection();
      hideThoughtDetail(true);
    }

    function onStagePointerLeave() {
      fieldPointer.energy = 0;
      stageDrag = null;
      colorField.pointerLeave();
      buttons.forEach((button) => button.classList.remove('is-near'));
      if (motion.reducedMotion) updateBubbleColors(12);
    }

    function exitLightfield() {
      location.hash = '#/new';
    }

    function bindBubble(button) {
      const id = button.getAttribute('data-bubble-id');
      button.addEventListener('focus', () => {
        selectBubble(id);
        showThoughtDetail(id, false);
      });
      button.addEventListener('pointerenter', () => showThoughtDetail(id, false));
      button.addEventListener('pointerleave', () => hideThoughtDetail(false));
      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        openThoughtEditor(id);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || bubbleById(id).bursting) return;
        button.focus({ preventScroll: true });
        cancelPointerPress();
        delete bubbleById(id).inertia;
        delete bubbleById(id).inertiaElapsed;
        const press = {
          id, button, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          startedAt: performance.now(), lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp,
          velocityX: 0, velocityY: 0, long: false, dragging: false, timer: null,
        };
        pointerPress = press;
        button.classList.add('is-pressing');
        try { button.setPointerCapture(event.pointerId); } catch (error) { void error; }
        press.timer = window.setTimeout(() => {
          if (pointerPress !== press) return;
          press.long = true;
          button.classList.remove('is-pressing');
          burst(id);
        }, motion.longPressMs);
      });
      button.addEventListener('pointermove', (event) => {
        const press = pointerPress;
        if (!press || press.pointerId !== event.pointerId || press.long) return;
        if (!press.dragging && dragApi.shouldStartDrag(event.clientX - press.x, event.clientY - press.y, 8)) {
          window.clearTimeout(press.timer);
          press.dragging = true;
          const bubble = bubbleById(id);
          bubble.dragging = true;
          button.classList.remove('is-pressing');
          button.classList.add('is-dragging');
          button.setAttribute('aria-grabbed', 'true');
          selectBubble(id);
        }
        if (!press.dragging) return;
        event.preventDefault();
        const bubble = bubbleById(id);
        if (!bubble) return;
        Object.assign(bubble, dragApi.dragBubbleTo(bubble, event.clientX, event.clientY, { width: window.innerWidth, height: window.innerHeight }));
        const dt = Math.max(8, event.timeStamp - press.lastTime) / 1000;
        press.velocityX = press.velocityX * 0.55 + ((event.clientX - press.lastX) / dt) * 0.45;
        press.velocityY = press.velocityY * 0.55 + ((event.clientY - press.lastY) / dt) * 0.45;
        press.lastX = event.clientX;
        press.lastY = event.clientY;
        press.lastTime = event.timeStamp;
        refreshBubble(bubble);
      });
      button.addEventListener('pointerup', (event) => {
        const press = pointerPress;
        if (!press || press.pointerId !== event.pointerId) return;
        colorField.pointerUp(event.clientX, event.clientY, false, event.pointerType);
        if (press.dragging) {
          finishDrag(press);
          window.clearTimeout(press.timer);
          pointerPress = null;
          button.dataset.suppressClick = 'true';
        } else {
          const wasLong = press.long;
          cancelPointerPress();
          if (wasLong) button.dataset.suppressClick = 'true';
        }
      });
      button.addEventListener('pointercancel', cancelPointerPress);
      button.addEventListener('lostpointercapture', () => {
        if (pointerPress && pointerPress.button === button && !pointerPress.long) cancelPointerPress();
      });
      button.addEventListener('click', () => {
        if (button.dataset.suppressClick === 'true') {
          delete button.dataset.suppressClick;
          return;
        }
        openMap(id);
      });
      button.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const index = buttons.indexOf(button);
          let nextIndex = index;
          if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = buttons.length - 1;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
          else nextIndex = (index + 1) % buttons.length;
          buttons[nextIndex].focus();
          return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          openThoughtEditor(id);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) burst(id);
          else if (!event.repeat) openMap(id);
          return;
        }
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          if (event.repeat || spacePress || bubbleById(id).bursting) return;
          const press = { id, button, long: false, timer: null };
          spacePress = press;
          const point = bubbleClientPoint(bubbleById(id));
          colorField.pointerDown(point.x, point.y);
          button.classList.add('is-pressing');
          press.timer = window.setTimeout(() => {
            if (spacePress !== press) return;
            press.long = true;
            button.classList.remove('is-pressing');
            burst(id);
          }, motion.longPressMs);
        }
      });
      button.addEventListener('keyup', (event) => {
        if (event.key !== ' ' && event.key !== 'Spacebar') return;
        event.preventDefault();
        if (!spacePress || spacePress.id !== id) return;
        const wasLong = spacePress.long;
        const point = bubbleClientPoint(bubbleById(id));
        colorField.pointerUp(point.x, point.y, false, 'keyboard');
        cancelSpacePress();
        if (!wasLong) openMap(id);
      });
      button.addEventListener('blur', () => {
        if (spacePress && spacePress.id === id) cancelSpacePress();
        if (pointerPress && pointerPress.id === id && pointerPress.long) cancelPointerPress();
      });
    }

    function onMotionChange() {
      motion = core.getMotionOptions(motionQuery.matches);
      startColorFrames();
    }

    function onMainKeydown(event) {
      if (event.key !== 'Escape') return;
      if (!editorPanel.hidden) {
        closeThoughtEditor();
        return;
      }
      if (!detailPanel.hidden) {
        hideThoughtDetail(true);
        return;
      }
      if (!corpusPanel.hidden) {
        corpusPanel.hidden = true;
        corpusButton.setAttribute('aria-expanded', 'false');
        corpusButton.focus();
      } else if (selectedId) clearSelection();
      else exitLightfield();
    }

    function onMainPointerMove(event) {
      const rect = exitButton.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      exitButton.classList.toggle('is-near', distance < 100);
    }

    stage.addEventListener('pointermove', onStagePointerMove);
    stage.addEventListener('pointerdown', onStagePointerDown);
    stage.addEventListener('pointerup', onStagePointerUp);
    stage.addEventListener('pointercancel', onStagePointerLeave);
    stage.addEventListener('pointerleave', onStagePointerLeave);
    exitButton.addEventListener('click', exitLightfield);
    corpusButton.addEventListener('click', () => {
      corpusPanel.hidden = !corpusPanel.hidden;
      corpusButton.setAttribute('aria-expanded', corpusPanel.hidden ? 'false' : 'true');
      updateCorpusUI();
    });
    main.querySelector('[data-corpus-close]').addEventListener('click', () => {
      corpusPanel.hidden = true;
      corpusButton.setAttribute('aria-expanded', 'false');
      corpusButton.focus();
    });
    editorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const bubble = bubbleById(editingId);
      if (!bubble || !session) return;
      const patch = thoughts.saveThoughtEdit(session, editingId, keywordInput.value, noteInput.value);
      if (!patch) {
        announce('请输入关键词后再保存');
        keywordInput.focus();
        return;
      }
      session.lightThoughts = patch.lightThoughts;
      SJ.store.updateSession(session.id, patch);
      bubble.text = keywordInput.value.trim().slice(0, 40);
      bubble.note = noteInput.value.trim().slice(0, 240);
      bubble.edited = true;
      decorateBubble(bubble);
      refreshBubble(bubble);
      updateBubbleColors(performance.now() / 1000);
      closeThoughtEditor();
      selectBubble(bubble.id);
      showThoughtDetail(bubble.id, true);
      announce('想法已保存到可编辑扩展数据，原始表达未修改');
    });
    main.querySelector('[data-edit-cancel]').addEventListener('click', closeThoughtEditor);
    main.addEventListener('pointermove', onMainPointerMove);
    main.addEventListener('keydown', onMainKeydown);
    motionQuery.addEventListener('change', onMotionChange);
    buttons = Array.from(main.querySelectorAll('[data-bubble-id]'));
    buttons.forEach(bindBubble);
    updateCorpusUI();
    startColorFrames();

    return function () {
      disposed = true;
      if (main._thoughtMap) main._thoughtMap.close();
      window.cancelAnimationFrame(colorFrameId);
      colorField.dispose();
      window.clearTimeout(hintTimer);
      window.clearTimeout(stagePulseTimer);
      glowTimers.forEach((timer) => window.clearTimeout(timer));
      cancelPointerPress();
      cancelSpacePress();
      motionQuery.removeEventListener('change', onMotionChange);
      main.removeEventListener('keydown', onMainKeydown);
      main.removeEventListener('pointermove', onMainPointerMove);
    };
  };
})();
