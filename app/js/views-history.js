/* 思迹 · 历史记录页 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;
  SJ.views = SJ.views || {};

  SJ.views.history = function (main) {
    const sessions = SJ.store.listSessions();

    main.innerHTML = `
      <div class="ws-head">
        <div>
          <h1 class="ws-title">历史记录</h1>
          <p class="ws-meta">共 ${sessions.length} 次思考 · 数据保存在${u.esc(SJ.store.dataLocation())}</p>
        </div>
        <div class="ws-actions">
          <a class="btn btn-primary" href="#/new">新的思考</a>
        </div>
      </div>

      ${sessions.length ? `<ul class="history-list">
        ${sessions.map((s) => historyItemHTML(s)).join('')}
      </ul>` : SJ.ui.empty('还没有任何思考记录', '从首页写下第一句话开始。')}`;

    bindItems(main, sessions);
  };

  function historyItemHTML(s) {
    return `
      <li class="history-item" data-id="${s.id}">
        <a class="history-main" href="#/s/${s.id}">
          <span class="history-title">${u.esc(s.title)}</span>
          <span class="history-excerpt">${u.esc(u.clamp(s.original.text.replace(/\s+/g, ' '), 60))}</span>
          <span class="history-meta">${u.relTime(s.updatedAt)} · ${SJ.views.statusLabel(s.status)}</span>
        </a>
        <div class="history-actions">
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}" title="继续或查看">继续</a>
          <a class="btn btn-ghost btn-sm" href="#/s/${s.id}/detail" title="详情">详情</a>
          <button type="button" class="btn btn-ghost btn-sm" data-act="rename" title="重命名">重命名</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="export" title="导出 Markdown">导出</button>
          <button type="button" class="btn btn-ghost btn-sm btn-danger-text" data-act="delete" title="删除">删除</button>
        </div>
      </li>`;
  }

  function bindItems(main, sessions) {
    main.querySelectorAll('.history-item').forEach((li) => {
      const id = li.getAttribute('data-id');
      const s = () => SJ.store.getSession(id);

      li.querySelector('[data-act="rename"]').addEventListener('click', () => {
        const cur = s();
        const close = SJ.ui.modal({
          title: '重命名',
          bodyHTML: `
            <form data-rename-form>
              <label class="sr-only" for="rename-input">新标题</label>
              <input id="rename-input" type="text" maxlength="60" value="${u.esc(cur.title)}">
            </form>`,
          actions: [
            { label: '取消', kind: 'ghost' },
            {
              label: '保存',
              kind: 'primary',
              onClick: (closeModal) => {
                const v = document.getElementById('rename-input').value.trim();
                if (v) {
                  SJ.store.renameSession(id, v);
                  SJ.ui.toast('已重命名');
                  SJ.app.render();
                }
                closeModal();
              },
            },
          ],
        });
        const input = document.getElementById('rename-input');
        input.focus();
        input.select();
        document.querySelector('[data-rename-form]').addEventListener('submit', (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (v) {
            SJ.store.renameSession(id, v);
            close();
            SJ.ui.toast('已重命名');
            SJ.app.render();
          }
        });
      });

      li.querySelector('[data-act="export"]').addEventListener('click', () => {
        SJ.exporter.download(s());
        SJ.ui.toast('已导出 Markdown');
      });

      li.querySelector('[data-act="delete"]').addEventListener('click', () => {
        SJ.ui.confirm('删除这次思考？', `「${u.clamp(s().title, 30)}」将从本地浏览器中永久删除，无法恢复。`, () => {
          SJ.store.deleteSession(id);
          SJ.ui.toast('已删除');
          SJ.app.render();
        });
      });
    });
  }
})();
