/* 思迹 · 澄清工作区（核心状态机）
 *
 * 阶段：
 *   blankTakeover  空白接管（暂停/关键词/原始表达/新方向）
 *   restating      第 1 轮：AI 简短复述生成中
 *   input          当前轮等待用户回答（提示卡三选一 / 自由填写）
 *   drafting       用户回答已保存，生成暂定问题中
 *   summary        展示暂定问题，等待确认 / 继续澄清 / 获取回答
 *   answering      已确认问题，生成回答中
 *   answered       展示回答 + 反馈
 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  /* 防止重复触发异步生成 */
  const pending = new Set();
  function lock(key) {
    if (pending.has(key)) return false;
    pending.add(key);
    return true;
  }
  function unlock(key) {
    pending.delete(key);
  }

  function userTextAll(s) {
    return (
      s.original.text +
      ' ' +
      (s.branches || []).map((b) => b.text).join(' ') +
      ' ' +
      s.rounds.map((r) => (r.answer ? r.answer.text : '')).join(' ')
    );
  }

  function isBlankActive(s) {
    const last = s.blanks[s.blanks.length - 1];
    return !!last && !last.resumedAt;
  }

  SJ.views.workspace = function (main, session) {
    const sid = session.id;

    /* ============ 0. 空白接管 ============ */
    if (isBlankActive(session)) {
      renderBlank(main, session);
      return;
    }

    /* ============ 1. 首轮：生成 AI 简短复述 ============ */
    if (session.rounds.length === 0) {
      if (lock(sid + ':restate')) {
        main.innerHTML = headHTML(session) + `
          <div class="card"><p class="muted">正在整理你的原话……</p></div>`;
        SJ.ai.restate(session).then((text) => {
          unlock(sid + ':restate');
          SJ.store.updateSession(sid, {
            aiSource: SJ.ai.source(),
            rounds: [{ n: 1, restatement: text, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }],
          });
          rerender();
        });
      } else {
        main.innerHTML = headHTML(session) + `<div class="card"><p class="muted">正在整理你的原话……</p></div>`;
      }
      return;
    }

    const round = session.rounds[session.rounds.length - 1];
    const answerCount = session.rounds.filter((r) => r.answer && r.answer.text && !r.answer.skipped).length;

    /* ============ 2. 已回答：生成暂定问题 ============ */
    if (round.answer && !round.draft) {
      if (lock(sid + ':draft:' + round.n)) {
        main.innerHTML = headHTML(session) + `
          ${originalCardHTML(session)}
          <div class="card"><p class="muted">正在根据你的回答更新暂定问题……</p></div>`;
        SJ.ai.draft(session).then((draft) => {
          unlock(sid + ':draft:' + round.n);
          const rounds = session.rounds.slice();
          rounds[rounds.length - 1] = Object.assign({}, round, { draft });
          SJ.store.updateSession(sid, { rounds });
          rerender();
        });
      } else {
        main.innerHTML = headHTML(session) + `<div class="card"><p class="muted">正在根据你的回答更新暂定问题……</p></div>`;
      }
      return;
    }

    /* ============ 3. 已确认：生成回答 ============ */
    if (session.status === 'confirmed') {
      if (lock(sid + ':answer')) {
        main.innerHTML = headHTML(session) + `<div class="card"><p class="muted">你确认了问题。正在整理回答……</p></div>`;
        SJ.ai.answer(session).then((ans) => {
          unlock(sid + ':answer');
          SJ.store.updateSession(sid, { answer: Object.assign({ ts: Date.now(), feedback: null }, ans), status: 'answered' });
          rerender();
        });
      } else {
        main.innerHTML = headHTML(session) + `<div class="card"><p class="muted">正在整理回答……</p></div>`;
      }
      return;
    }

    /* ============ 4. 回答完成 ============ */
    if (session.status === 'answered' && session.answer) {
      renderAnswered(main, session);
      return;
    }

    /* ============ 5. 汇总阶段：展示暂定问题 ============ */
    if (round.answer && round.draft) {
      renderSummary(main, session, round, answerCount);
      return;
    }

    /* ============ 6. 输入阶段：提示卡 + 回答框 ============ */
    renderInput(main, session, round);
  };

  function rerender() {
    SJ.app.render();
    const main = document.getElementById('main');
    if (main) main.focus && main.focus();
  }

  function headHTML(s) {
    return `
      <div class="ws-head">
        <div>
          <h1 class="ws-title">${u.esc(s.title)}</h1>
          <p class="ws-meta">${SJ.views.statusLabel(s.status)} · 更新于 ${u.relTime(s.updatedAt)}</p>
        </div>
        <div class="ws-actions">
          <a class="btn btn-ghost btn-sm" href="#/light">光影</a>
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/path">思考路径</a>
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/detail">详情与导出</a>
          <button type="button" class="btn btn-calm btn-sm" data-blank>我现在空白了</button>
        </div>
      </div>`;
  }

  function bindHead(main, s) {
    const btn = main.querySelector('[data-blank]');
    if (btn) btn.addEventListener('click', () => openBlankChoose(main, s));
  }

  function originalCardHTML(s, opts) {
    opts = opts || {};
    const branches = (s.branches || [])
      .map(
        (b) => `
      <div class="branch-block">
        <p class="node-label">新方向的原始表达 · ${u.timeOnly(b.ts)}</p>
        <p class="quote">${u.textToHtml(b.text)}</p>
      </div>`
      )
      .join('');
    return `
      <section class="card card-original" aria-label="原始表达">
        <p class="node-label">原始表达 · ${u.timeOnly(s.original.ts)} <span class="tag-solid">原话，不可修改</span></p>
        <p class="quote">${u.textToHtml(s.original.text)}</p>
        ${branches}
        ${pluginContextHTML(s)}
        ${opts.collapsible ? `<details class="orig-details"><summary>查看完整原始表达</summary><p class="quote">${u.textToHtml(s.original.text)}</p></details>` : ''}
      </section>`;
  }

  function pluginContextHTML(s) {
    const context = s.pluginContext;
    if (!context || !Array.isArray(context.userMessages) || !context.userMessages.length) return '';
    const messages = context.userMessages.map((message) => `
      <div class="branch-block">
        <p class="node-label">近期用户原话 · ${u.esc(message.id)}</p>
        <p class="quote">${u.textToHtml(message.text)}</p>
      </div>`).join('');
    return `<details class="orig-details">
      <summary>查看扩展带来的近期对话（辅助上下文，不替代原始表达）</summary>
      ${context.sourceUrl ? `<p class="muted">来源：${u.esc(context.sourceUrl)}</p>` : ''}
      ${messages}
    </details>`;
  }

  /* ---------------- 输入阶段 ---------------- */
  function renderInput(main, s, round) {
    const isR1 = round.n === 1;
    const activeRounds = Math.min(round.n, 3);

    main.innerHTML = headHTML(s) + `
      ${originalCardHTML(s)}
      <p class="round-indicator">第 ${round.n} 轮澄清${round.n <= 3 ? `（主动澄清最多 3 轮，可随时确认或跳过）` : '（已超过 3 轮主动澄清，由你决定何时结束）'}</p>

      ${isR1 && round.restatement ? `
      <section class="card card-ai" aria-label="AI 简短复述">
        <p class="node-label node-label-ai"><span class="dot-ai" aria-hidden="true"></span>AI 简短复述 · 推测内容，可随时纠正</p>
        <p class="restatement">${u.textToHtml(round.restatement)}</p>
        <div class="correct-row">
          <button type="button" class="link-btn" data-toggle-correct>不对，我的意思是……</button>
          <form class="correct-form hidden" data-correct-form>
            <label class="sr-only" for="correct-input">纠正 AI 的理解</label>
            <input id="correct-input" type="text" maxlength="200" placeholder="告诉我哪里理解偏了">
            <button type="submit" class="btn btn-ghost btn-sm">记录纠正</button>
          </form>
        </div>
      </section>` : ''}

      <section aria-label="思考提示">
        <p class="node-label">三个轻量提示 <span class="muted-inline">每次只做一个小动作就好</span></p>
        <div class="hint-grid" data-hints>
          ${round.hints ? round.hints.map((h, i) => hintCardHTML(h, i, round.chosenHint)).join('') : `<div class="card"><p class="muted">正在准备提示……</p></div>`}
        </div>
        <div class="hint-foot">
          <button type="button" class="link-btn" data-refresh-hints>换一组提示</button>
        </div>
      </section>

      <section class="card" aria-label="写下你的想法">
        <p class="node-label">你的下一句想法</p>
        <form data-answer-form>
          <label class="sr-only" for="answer-input">回答或补充</label>
          <textarea id="answer-input" rows="3" maxlength="2000"
            placeholder="${round.chosenHint ? '顺着这个提示，想到什么写什么。' : '也可以不选提示，直接写下一句。'}"></textarea>
          <div class="composer-foot">
            <p class="composer-note">${round.chosenHint ? `已选提示：${u.esc(round.chosenHint.type)}` : '写多少都可以，一句也算。'} · Ctrl/⌘ + Enter 保存</p>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost" data-skip>跳过澄清，直接形成暂定问题</button>
              <button type="submit" class="btn btn-primary">保存这句想法</button>
            </div>
          </div>
        </form>
      </section>`;

    bindHead(main, s);

    /* 提示卡：点击选择 */
    main.querySelectorAll('[data-hint-index]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = parseInt(el.getAttribute('data-hint-index'), 10);
        const rounds = s.rounds.slice();
        const cur = rounds[rounds.length - 1];
        const was = cur.chosenHint && cur.chosenHint.id === (cur.hints[i] && cur.hints[i].id);
        rounds[rounds.length - 1] = Object.assign({}, cur, { chosenHint: was ? null : cur.hints[i] });
        SJ.store.updateSession(s.id, { rounds });
        rerender();
        setTimeout(() => {
          const ta = document.getElementById('answer-input');
          if (ta) ta.focus();
        }, 0);
      });
    });

    /* 换一组提示 */
    const refreshBtn = main.querySelector('[data-refresh-hints]');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        const key = s.id + ':hints:' + round.n;
        if (!lock(key)) return;
        refreshBtn.disabled = true;
        const offset = (round.hintOffset || 0) + 1;
        SJ.ai.hints(s, offset).then((hints) => {
          unlock(key);
          const rounds = s.rounds.slice();
          const cur = rounds[rounds.length - 1];
          rounds[rounds.length - 1] = Object.assign({}, cur, { hints, hintOffset: offset, chosenHint: null });
          SJ.store.updateSession(s.id, { rounds });
          rerender();
        });
      });
    }

    /* 首轮若无提示（异步生成中触发） */
    if (!round.hints) {
      const key = s.id + ':hints:' + round.n;
      if (lock(key)) {
        SJ.ai.hints(s, round.hintOffset || 0).then((hints) => {
          unlock(key);
          const rounds = s.rounds.slice();
          const cur = rounds[rounds.length - 1];
          rounds[rounds.length - 1] = Object.assign({}, cur, { hints });
          SJ.store.updateSession(s.id, { rounds });
          rerender();
        });
      }
    }

    /* 保存回答 */
    const form = main.querySelector('[data-answer-form]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = form.querySelector('textarea');
      const text = ta.value.trim();
      if (!text) {
        SJ.ui.toast('写一句什么都可以，或者点「跳过」');
        ta.focus();
        return;
      }
      const rounds = s.rounds.slice();
      const cur = rounds[rounds.length - 1];
      rounds[rounds.length - 1] = Object.assign({}, cur, {
        answer: { text, ts: Date.now() },
        selfWritten: !cur.chosenHint,
      });
      SJ.store.updateSession(s.id, { rounds });
      rerender();
    });

    /* 跳过澄清 */
    main.querySelector('[data-skip]').addEventListener('click', () => {
      const rounds = s.rounds.slice();
      const cur = rounds[rounds.length - 1];
      if (cur.answer) return;
      rounds[rounds.length - 1] = Object.assign({}, cur, { skipped: true, answer: { text: '', ts: Date.now(), skipped: true } });
      SJ.store.updateSession(s.id, { rounds });
      rerender();
    });

    /* 纠正 AI */
    const toggle = main.querySelector('[data-toggle-correct]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        main.querySelector('[data-correct-form]').classList.toggle('hidden');
      });
      main.querySelector('[data-correct-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        saveCorrection(s, text);
        SJ.ui.toast('已记录你的纠正');
        rerender();
      });
    }
  }

  function hintCardHTML(h, i, chosen) {
    const active = chosen && chosen.id === h.id;
    return `
      <button type="button" class="hint-card ${active ? 'is-chosen' : ''}" data-hint-index="${i}" aria-pressed="${active ? 'true' : 'false'}">
        <span class="hint-type">${u.esc(h.type)}</span>
        <span class="hint-text">${u.esc(h.text)}</span>
        <span class="hint-mark">${active ? '✓ 已选' : '选一个'}</span>
      </button>`;
  }

  function saveCorrection(s, text) {
    const mis = s.misunderstandings.concat([{ text, ts: Date.now() }]);
    const rounds = s.rounds.slice();
    const cur = rounds[rounds.length - 1];
    rounds[rounds.length - 1] = Object.assign({}, cur, { corrections: (cur.corrections || []).concat([{ text, ts: Date.now() }]) });
    SJ.store.updateSession(s.id, { misunderstandings: mis, rounds });
  }

  /* ---------------- 汇总阶段 ---------------- */
  function renderSummary(main, s, round, answerCount) {
    const over3 = answerCount >= 3;

    main.innerHTML = headHTML(s) + `
      ${originalCardHTML(s, { collapsible: true })}

      ${round.answer && round.answer.text ? `
      <section class="card card-original">
        <p class="node-label">你刚刚补充的原话 · ${u.timeOnly(round.answer.ts)}
          ${round.chosenHint ? `<span class="tag tag-hint">提示：${u.esc(round.chosenHint.type)}</span>` : '<span class="tag">自由补充</span>'}
        </p>
        <p class="quote">${u.textToHtml(round.answer.text)}</p>
      </section>` : `
      <section class="card"><p class="muted">你选择了跳过澄清。</p></section>`}

      <section class="card card-question" aria-label="当前暂定问题">
        <p class="node-label">当前暂定问题 <span class="muted-inline">可以直接修改，最终以你写的为准</span></p>
        <label class="sr-only" for="draft-text">暂定问题</label>
        <textarea id="draft-text" rows="3" maxlength="300">${u.esc(round.draft.text)}</textarea>
        <div class="ai-part">
          <p class="node-label-ai"><span class="dot-ai" aria-hidden="true"></span>其中 AI 推测的部分（可否定）：</p>
          <p>${u.esc(round.draft.aiPart || '（无）')}</p>
        </div>
        <div class="correct-row">
          <button type="button" class="link-btn" data-toggle-correct>否定这个理解</button>
          <form class="correct-form hidden" data-correct-form>
            <label class="sr-only" for="correct-input">否定 AI 的理解</label>
            <input id="correct-input" type="text" maxlength="200" placeholder="告诉我哪里不对">
            <button type="submit" class="btn btn-ghost btn-sm">记录并更新</button>
          </form>
        </div>
      </section>

      <div class="decide-bar">
        <button type="button" class="btn btn-ghost" data-continue>继续澄清</button>
        ${over3 ? `<button type="button" class="btn btn-ghost" data-answer-now>直接获取回答</button>` : ''}
        <button type="button" class="btn btn-primary btn-lg" data-confirm>这就是我现在想问的</button>
      </div>
      <p class="decide-note">${over3 ? '已经澄清 ' + answerCount + ' 轮。可以由你决定：确认、继续，或直接获取回答。' : '澄清了 ' + answerCount + ' 轮。最多主动进行 3 轮，之后仍由你决定何时结束。'}</p>`;

    bindHead(main, s);

    const draftTa = main.querySelector('#draft-text');

    function persistDraftText() {
      const rounds = s.rounds.slice();
      const cur = rounds[rounds.length - 1];
      rounds[rounds.length - 1] = Object.assign({}, cur, { draft: Object.assign({}, cur.draft, { text: draftTa.value.trim() || cur.draft.text }) });
      SJ.store.updateSession(s.id, { rounds });
      return rounds[rounds.length - 1].draft.text;
    }

    main.querySelector('[data-continue]').addEventListener('click', () => {
      persistDraftText();
      const rounds = s.rounds.concat([{ n: round.n + 1, restatement: null, hints: null, hintOffset: round.hintOffset || 0, chosenHint: null, answer: null, draft: null, corrections: [] }]);
      SJ.store.updateSession(s.id, { rounds, status: 'clarifying' });
      rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    function confirmAndAnswer() {
      const text = persistDraftText();
      SJ.store.updateSession(s.id, { confirmed: { text, ts: Date.now() }, status: 'confirmed' });
      rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    main.querySelector('[data-confirm]').addEventListener('click', confirmAndAnswer);
    const answerNow = main.querySelector('[data-answer-now]');
    if (answerNow) answerNow.addEventListener('click', confirmAndAnswer);

    /* 否定理解：记录 + 重新生成暂定问题 */
    main.querySelector('[data-toggle-correct]').addEventListener('click', () => {
      main.querySelector('[data-correct-form]').classList.toggle('hidden');
    });
    main.querySelector('[data-correct-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      saveCorrection(s, text);
      /* 清掉当前 draft，触发重新生成（transcript 已包含这条纠正） */
      const rounds = s.rounds.slice();
      const cur = rounds[rounds.length - 1];
      rounds[rounds.length - 1] = Object.assign({}, cur, { draft: null });
      SJ.store.updateSession(s.id, { rounds });
      SJ.ui.toast('已记录，正在重新整理暂定问题');
      rerender();
    });
  }

  /* ---------------- 回答完成 ---------------- */
  function renderAnswered(main, s) {
    const a = s.answer;
    const sec = (title, arr, cls) => `
      <section class="card ${cls || ''}">
        <p class="node-label ${cls === 'card-ai' ? 'node-label-ai' : ''}">${cls === 'card-ai' ? '<span class="dot-ai" aria-hidden="true"></span>' : ''}${title}</p>
        <ul class="plain-list">${(arr || []).map((x) => `<li>${u.textToHtml(x)}</li>`).join('') || '<li class="muted">（无）</li>'}</ul>
      </section>`;

    main.innerHTML = headHTML(s) + `
      <section class="card card-question card-confirmed">
        <p class="node-label">你确认的问题</p>
        <p class="confirmed-q">${u.textToHtml(s.confirmed ? s.confirmed.text : '')}</p>
      </section>

      ${a.demo ? `<p class="demo-notice">以下为「演示模式」生成的示例回答（规则模板，非真实 AI 能力），接入 API 后此处由真实模型生成。</p>` : ''}

      ${sec('相对确定的事实', a.facts)}
      ${sec('基于假设的解释（均为推测，可否定）', a.assumptions, 'card-ai')}
      ${sec('仍然缺少的信息', a.missing)}
      ${sec('你可以继续验证的方向', a.next)}

      <section class="card" aria-label="反馈">
        <p class="node-label">这个回答怎么样？</p>
        <div class="btn-row">
          <button type="button" class="btn ${a.feedback === 'accurate' ? 'btn-primary' : 'btn-ghost'}" data-fb="accurate">问题理解准确</button>
          <button type="button" class="btn ${a.feedback === 'helpful' ? 'btn-primary' : 'btn-ghost'}" data-fb="helpful">回答有帮助</button>
          <button type="button" class="btn ${a.feedback === 'wrong' ? 'btn-primary' : 'btn-ghost'}" data-fb="wrong">AI 理解错了，返回修改</button>
        </div>
        <p class="muted">反馈只保存在本地，用于记录你的想法演化。</p>
      </section>

      <div class="decide-bar">
        <a class="btn btn-ghost" href="#/s/${s.id}/path">查看思考路径</a>
        <a class="btn btn-ghost" href="#/s/${s.id}/detail">详情与导出</a>
      </div>`;

    bindHead(main, s);

    main.querySelectorAll('[data-fb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-fb');
        if (v === 'wrong') {
          SJ.store.updateSession(s.id, {
            status: 'clarifying',
            misunderstandings: s.misunderstandings.concat([{ text: '回答阶段反馈：AI 理解错了，返回修改', ts: Date.now() }]),
            rounds: s.rounds.concat([{ n: s.rounds.length + 1, restatement: null, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }]),
          });
          SJ.ui.toast('好，回到澄清。告诉 AI 哪里不对。');
          rerender();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          SJ.store.updateSession(s.id, { answer: Object.assign({}, a, { feedback: v }) });
          SJ.ui.toast('已记录反馈');
          rerender();
        }
      });
    });
  }

  /* ---------------- 空白流程 ---------------- */
  const BLANK_OPTS = [
    { key: 'pause', label: '暂时停一下', desc: '不做什么，就停在这里。' },
    { key: 'keywords', label: '只看刚才的三个关键词', desc: '把范围缩到最小。' },
    { key: 'original', label: '回到空白前的原始表达', desc: '看看你最初写下的原话。' },
    { key: 'restart', label: '不等它了，从新的方向开始', desc: '允许换一条路走。' },
  ];

  function openBlankChoose(main, s) {
    const close = SJ.ui.modal({
      title: '我现在空白了',
      bodyHTML: `
        <p class="modal-text">没关系，空白也是被允许的状态。选一个现在能承受的方式：</p>
        <div class="blank-opts">
          ${BLANK_OPTS.map(
            (o, i) => `
            <button type="button" class="blank-opt" data-opt="${i}">
              <span class="blank-opt-label">${o.label}</span>
              <span class="blank-opt-desc">${o.desc}</span>
            </button>`
          ).join('')}
        </div>
        <p class="modal-text muted">也可以什么都不选，直接关掉这个窗口。</p>`,
      actions: [{ label: '先关掉', kind: 'ghost' }],
    });
    document.querySelectorAll('.blank-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const opt = BLANK_OPTS[parseInt(btn.getAttribute('data-opt'), 10)].key;
        close();
        SJ.store.updateSession(s.id, {
          blanks: s.blanks.concat([{ startedAt: Date.now(), option: opt, prevStatus: s.status }]),
          status: 'blank',
        });
        rerender();
      });
    });
  }



  function renderBlank(main, s) {
    const b = s.blanks[s.blanks.length - 1];
    let bodyHTML = '';

    if (b.option === 'pause') {
      bodyHTML = `
        <div class="blank-screen">
          <p class="blank-big">好，先停一下。</p>
          <p class="blank-sub">想法不会跑掉。你回来的时候，它还在这里。</p>
          <button type="button" class="btn btn-primary btn-lg" data-resume>我回来了</button>
          <a class="link-muted" href="#/history">先去别的地方</a>
        </div>`;
    } else if (b.option === 'keywords') {
      const kws = SJ.demoAI._extractKeywords(userTextAll(s), 3);
      bodyHTML = `
        <div class="blank-screen">
          <p class="blank-sub">刚才的内容里，只留下这几个词：</p>
          <div class="kw-row">${kws.length ? kws.map((k) => `<span class="kw">${u.esc(k)}</span>`).join('') : '<span class="muted">（还没提取到关键词）</span>'}</div>
          <button type="button" class="btn btn-primary btn-lg" data-resume>我回来了</button>
        </div>`;
    } else if (b.option === 'original') {
      bodyHTML = `
        <div class="blank-screen">
          <p class="blank-sub">这是你最初写下的原话，一字未改：</p>
          <blockquote class="blank-quote">${u.textToHtml(s.original.text)}</blockquote>
          <button type="button" class="btn btn-primary btn-lg" data-resume>我回来了</button>
        </div>`;
    } else if (b.option === 'restart') {
      bodyHTML = restartFormHTML();
    }

    main.innerHTML = `
      <div class="ws-head"><div>
        <h1 class="ws-title">${u.esc(s.title)}</h1>
        <p class="ws-meta">空白中 · 从 ${u.timeOnly(b.startedAt)} 开始</p>
      </div></div>
      <section class="card">${bodyHTML}</section>`;

    const resumeBtn = main.querySelector('[data-resume]');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => openResumeJudge(s, null));
    }
    bindRestartForm(main, s);
  }

  function restartFormHTML() {
    return `
      <div class="blank-screen">
        <p class="blank-sub">不用等原来的想法。新的方向是什么？想到哪写到哪。</p>
        <form data-restart-form>
          <label class="sr-only" for="restart-input">新的方向</label>
          <textarea id="restart-input" rows="4" maxlength="2000" placeholder="从一个新的方向开始写……"></textarea>
          <div class="btn-row center">
            <button type="submit" class="btn btn-primary btn-lg">把这个留下来</button>
          </div>
        </form>
      </div>`;
  }

  function bindRestartForm(main, s) {
    const form = main.querySelector('[data-restart-form]');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = form.querySelector('textarea').value.trim();
      if (!text) {
        SJ.ui.toast('写一点什么都可以');
        return;
      }
      const blanks = s.blanks.slice();
      const last = blanks[blanks.length - 1];
      blanks[blanks.length - 1] = Object.assign({}, last, { resumedAt: Date.now(), verdict: 'new', newText: text });
      SJ.store.updateSession(s.id, {
        blanks,
        branches: (s.branches || []).concat([{ text, ts: Date.now() }]),
        status: 'clarifying',
        rounds: s.rounds.length
          ? s.rounds
          : [{ n: 1, restatement: null, hints: null, hintOffset: 0, chosenHint: null, answer: null, draft: null, corrections: [] }],
      });
      SJ.ui.toast('新方向已留下。回到澄清。');
      rerender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* 恢复判断：回来了 / 修改 / 新方向 */
  function openResumeJudge(s, after) {
    const VERDICTS = [
      { key: 'back', label: '原来的想法回来了', desc: '从停下的地方继续。' },
      { key: 'modified', label: '这是对原想法的修改', desc: '继续，但方向有点不一样。' },
      { key: 'new', label: '这是一个新方向', desc: '旧的想法先放一放。' },
    ];
    const close = SJ.ui.modal({
      title: '欢迎回来',
      bodyHTML: `
        <p class="modal-text">现在是什么状态？没有标准答案，选最接近的就好。</p>
        <div class="blank-opts">
          ${VERDICTS.map(
            (v, i) => `
            <button type="button" class="blank-opt" data-v="${i}">
              <span class="blank-opt-label">${v.label}</span>
              <span class="blank-opt-desc">${v.desc}</span>
            </button>`
          ).join('')}
        </div>`,
      dismissible: false,
      actions: [],
    });
    document.querySelectorAll('.blank-opt[data-v]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = VERDICTS[parseInt(btn.getAttribute('data-v'), 10)].key;
        close();
        if (v === 'new') {
          /* 原地切到新方向表单 */
          const main = document.getElementById('main');
          const card = main.querySelector('.card');
          if (card) {
            card.innerHTML = restartFormHTML();
            bindRestartForm(main, s);
          }
        } else {
          const blanks = s.blanks.slice();
          const last = blanks[blanks.length - 1];
          blanks[blanks.length - 1] = Object.assign({}, last, { resumedAt: Date.now(), verdict: v });
          // 恢复到空白发生前的状态（如已回答则回到回答页）
          SJ.store.updateSession(s.id, { blanks, status: last.prevStatus || 'clarifying' });
          rerender();
        }
        if (after) after();
      });
    });
  }
})();
