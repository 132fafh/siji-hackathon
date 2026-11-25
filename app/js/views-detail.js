/* 思迹 · 单次思考详情与导出页 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  SJ.views.detail = function (main, s) {
    const md = SJ.exporter.sessionToMarkdown(s);

    const block = (title, inner, isAI) => `
      <section class="card ${isAI ? 'card-ai' : ''}">
        <p class="node-label ${isAI ? 'node-label-ai' : ''}">${isAI ? '<span class="dot-ai" aria-hidden="true"></span>' : ''}${title}</p>
        ${inner}
      </section>`;

    const quote = (t) => `<p class="quote">${u.textToHtml(t)}</p>`;
    const list = (arr) => `<ul class="plain-list">${(arr || []).map((x) => `<li>${u.textToHtml(x)}</li>`).join('') || '<li class="muted">（无）</li>'}</ul>`;

    main.innerHTML = `
      <div class="ws-head">
        <div>
          <h1 class="ws-title">${u.esc(s.title)}</h1>
          <p class="ws-meta">创建 ${u.fmtTime(s.createdAt)} · 更新 ${u.fmtTime(s.updatedAt)} · AI 来源：${s.aiSource === 'api' ? '真实 AI（API）' : '演示模式'}</p>
        </div>
        <div class="ws-actions">
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}">工作区</a>
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/path">思考路径</a>
        </div>
      </div>

      ${block('原始表达（未被修改）', quote(s.original.text) + `<p class="muted">${u.fmtTime(s.original.ts)}</p>`)}
      ${(s.branches || []).map((b) => block('新方向的原始表达', quote(b.text) + `<p class="muted">${u.fmtTime(b.ts)}</p>`)).join('')}

      ${s.rounds.length ? block('澄清过程', `
        <ol class="detail-rounds">
          ${s.rounds.map((r) => `
            <li>
              ${r.restatement ? `<p class="detail-ai-line">AI 复述（推测）：${u.textToHtml(r.restatement)}</p>` : ''}
              ${r.chosenHint ? `<p><span class="tag tag-hint">${u.esc(r.chosenHint.type)}</span> ${u.esc(r.chosenHint.text)}</p>` : ''}
              ${r.answer && r.answer.text ? `<p class="quote">${u.textToHtml(r.answer.text)}</p>` : ''}
              ${r.answer && r.answer.skipped ? '<p class="muted">跳过了澄清。</p>' : ''}
              ${r.draft ? `<p><strong>暂定问题：</strong>${u.esc(r.draft.text)}${r.draft.aiPart ? ` <em class="muted">（AI 推测：${u.esc(r.draft.aiPart)}）</em>` : ''}</p>` : ''}
            </li>`).join('')}
        </ol>`) : ''}

      ${s.misunderstandings.length ? block('被否定的 AI 理解', list(s.misunderstandings.map((m) => `${u.fmtTime(m.ts)} · ${m.text}`))) : ''}

      ${s.blanks && s.blanks.length ? block('空白与恢复', list(s.blanks.map((b) => {
        const optNames = { pause: '暂时停一下', keywords: '只看三个关键词', original: '回到原始表达', restart: '从新的方向开始' };
        const verdictNames = { back: '原来的想法回来了', modified: '这是对原想法的修改', new: '这是一个新方向' };
        return `${u.fmtTime(b.startedAt)}：选择「${optNames[b.option] || b.option}」${b.resumedAt ? `，${u.fmtTime(b.resumedAt)} 恢复` : '（尚未恢复）'}${b.verdict ? ` · ${verdictNames[b.verdict] || b.verdict}` : ''}`;
      }))) : ''}
      ${s.confirmed ? block('最终确认的问题', quote(s.confirmed.text), false) : ''}

      ${s.answer ? `
        ${block('回答 · 相对确定的事实', list(s.answer.facts))}
        ${block('回答 · 基于假设的解释（推测）', list(s.answer.assumptions), true)}
        ${block('回答 · 仍然缺少的信息', list(s.answer.missing))}
        ${block('回答 · 可以继续验证的方向', list(s.answer.next))}
        ${s.answer.feedback ? block('用户反馈', quote({ accurate: '问题理解准确', helpful: '回答有帮助', wrong: 'AI 理解错了，已返回修改' }[s.answer.feedback] || s.answer.feedback)) : ''}
      ` : ''}

      ${s.lightThoughts && Object.keys(s.lightThoughts).length ? block('可编辑想法（扩展数据，不修改原始表达）', `<ul class="plain-list">${Object.entries(s.lightThoughts).map(([id, thought]) => `<li><strong>${u.esc(thought.keyword)}</strong>${thought.note ? `：${u.textToHtml(thought.note)}` : ''}${thought.updatedAt ? `<p class="muted">${u.fmtTime(thought.updatedAt)}</p>` : ''}</li>`).join('')}</ul>`) : ''}

      <section class="card" aria-label="导出">
        <p class="node-label">导出这次思考</p>
        <p class="muted">Markdown 文件包含原始表达、澄清过程、被否定的理解、空白事件与最终回答。</p>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-export>下载 Markdown</button>
          <button type="button" class="btn btn-ghost" data-copy>复制 Markdown 文本</button>
        </div>
      </section>`;

    main.querySelector('[data-export]').addEventListener('click', () => {
      SJ.exporter.download(s);
      SJ.ui.toast('已导出 Markdown');
    });
    main.querySelector('[data-copy]').addEventListener('click', () => {
      const done = () => SJ.ui.toast('已复制到剪贴板');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done, () => fallbackCopy(md, done));
      } else {
        fallbackCopy(md, done);
      }
    });

    function fallbackCopy(text, done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { SJ.ui.toast('复制失败，请手动复制'); }
      ta.remove();
    }
  };
})();
