/* 思迹 · 思考路径页（纵向时间线）
 * 视觉规则：用户原话=实线节点；AI 推测=虚线节点并标注；空白/不确定原样保留。
 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  function buildEvents(s) {
    const ev = [];
    const push = (ts, type, html, label) => ev.push({ ts, type, html, label });

    push(s.original.ts, 'user', `<p class="quote">${u.textToHtml(s.original.text)}</p>`, '原始表达');

    (s.branches || []).forEach((b) => {
      push(b.ts, 'user', `<p class="quote">${u.textToHtml(b.text)}</p>`, '新方向的原始表达');
    });

    s.rounds.forEach((r) => {
      if (r.restatement) {
        push(s.original.ts + r.n, 'ai', `<p>${u.textToHtml(r.restatement)}</p>`, `AI 简短复述（推测）`);
      }
      if (r.chosenHint) {
        push(r.answer ? r.answer.ts - 1 : s.updatedAt - r.n, 'hint', `<p><span class="tag tag-hint">${u.esc(r.chosenHint.type)}</span> ${u.esc(r.chosenHint.text)}</p>`, '选择的提示');
      }
      if (r.answer && r.answer.text) {
        push(r.answer.ts, 'user', `<p class="quote">${u.textToHtml(r.answer.text)}</p>`, `第 ${r.n} 轮 · 你的回答`);
      }
      if (r.answer && r.answer.skipped) {
        push(r.answer.ts, 'event', `<p>跳过了澄清，直接形成暂定问题。</p>`, '事件');
      }
      (r.corrections || []).forEach((c) => {
        push(c.ts, 'reject', `<p>${u.textToHtml(c.text)}</p>`, '否定 AI 的理解');
      });
      if (r.draft) {
        push((r.answer && r.answer.ts ? r.answer.ts : s.updatedAt) + 1, 'ai', `
          <p>${u.esc(r.draft.text)}</p>
          ${r.draft.aiPart ? `<p class="path-aipart">AI 推测部分：${u.esc(r.draft.aiPart)}</p>` : ''}`, `第 ${r.n} 轮 · 暂定问题`);
      }
    });

    s.misunderstandings.forEach((m) => {
      const inRound = s.rounds.some((r) => (r.corrections || []).some((c) => c.ts === m.ts));
      if (!inRound) push(m.ts, 'reject', `<p>${u.textToHtml(m.text)}</p>`, '否定 AI 的理解');
    });

    const optNames = { pause: '暂时停一下', keywords: '只看三个关键词', original: '回到原始表达', restart: '从新的方向开始' };
    const verdictNames = { back: '原来的想法回来了', modified: '这是对原想法的修改', new: '这是一个新方向' };
    s.blanks.forEach((b) => {
      push(b.startedAt, 'blank', `<p>选择「${optNames[b.option] || b.option}」。</p>`, '空白');
      if (b.resumedAt) {
        push(b.resumedAt, 'resume', `<p>${verdictNames[b.verdict] || '恢复了'}${b.newText ? `，新方向：「${u.clamp(b.newText, 40)}」` : ''}。</p>`, '恢复');
      }
    });

    if (s.confirmed) {
      push(s.confirmed.ts, 'confirmed', `<p class="quote">${u.textToHtml(s.confirmed.text)}</p>`, '确认的问题');
    }

    if (s.answer) {
      const a = s.answer;
      const parts = [
        ['相对确定的事实', a.facts],
        ['基于假设的解释（推测）', a.assumptions],
        ['仍然缺少的信息', a.missing],
        ['可以继续验证的方向', a.next],
      ];
      parts.forEach(([label, arr], i) => {
        if (arr && arr.length) {
          push(a.ts + i + 1, 'ai', `<p class="node-label">${label}</p><ul class="plain-list">${arr.map((x) => `<li>${u.textToHtml(x)}</li>`).join('')}</ul>`, '回答 · ' + (a.demo ? '演示模式' : 'AI'));
        }
      });
    }

    // 排序：ts 为主，同 ts 时按插入顺序（stable sort）
    return ev.map((e, i) => Object.assign({ _i: i }, e)).sort((a, b) => (a.ts - b.ts) || (a._i - b._i));
  }

  const TYPE_LABEL = {
    user: '你的原话',
    ai: 'AI（推测）',
    hint: '提示',
    event: '事件',
    reject: '否定',
    blank: '空白',
    resume: '恢复',
    confirmed: '确认',
  };

  SJ.views.path = function (main, s) {
    const events = buildEvents(s);

    main.innerHTML = `
      <div class="ws-head">
        <div>
          <h1 class="ws-title">思考路径</h1>
          <p class="ws-meta">${u.esc(s.title)} · ${u.fmtTime(s.createdAt)}</p>
        </div>
        <div class="ws-actions">
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}">回到工作区</a>
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/detail">详情与导出</a>
        </div>
      </div>

      <p class="path-legend">
        <span class="legend-item"><span class="legend-dot legend-user"></span>用户原话（实线）</span>
        <span class="legend-item"><span class="legend-dot legend-ai"></span>AI 推测（虚线，已标注）</span>
        <span class="legend-item"><span class="legend-dot legend-event"></span>空白 / 否定 / 事件（原样保留）</span>
      </p>

      <ol class="timeline">
        ${events
          .map(
            (e) => `
          <li class="tl-item tl-${e.type}">
            <div class="tl-node" aria-hidden="true"></div>
            <div class="tl-body">
              <p class="tl-label">${u.esc(TYPE_LABEL[e.type] || e.label)}${e.label && e.label !== (TYPE_LABEL[e.type] || '') ? ' · ' + u.esc(e.label) : ''}</p>
              ${e.html}
              <p class="tl-time">${u.fmtTime(e.ts)}</p>
            </div>
          </li>`
          )
          .join('')}
      </ol>

      <div class="decide-bar">
        <a class="btn btn-ghost" href="#/history">回到记录</a>
        <a class="btn btn-primary" href="#/s/${s.id}">回到工作区</a>
      </div>`;
  };
})();
