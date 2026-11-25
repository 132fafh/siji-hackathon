/* 思迹 · 通用 UI 组件（无框架，直接操作 DOM） */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;

  const ui = {
    /** 顶部模式徽标：演示模式常驻提醒 */
    sourceBadge() {
      const isDemo = SJ.ai.source() === 'demo';
      return `<span class="badge ${isDemo ? 'badge-demo' : 'badge-api'}" title="${isDemo ? '当前由本地规则生成内容，非真实 AI' : '当前通过 API 调用真实 AI'}">${isDemo ? '演示模式' : 'AI 已接入'}</span>`;
    },

    /** 空状态 */
    empty(title, sub) {
      return `<div class="empty"><p class="empty-title">${u.esc(title)}</p>${sub ? `<p class="empty-sub">${u.esc(sub)}</p>` : ''}</div>`;
    },

    /**
     * 模态框
     * opts: { title, bodyHTML, actions: [{label, kind:'primary'|'ghost'|'danger', onClick(close)}], dismissible }
     */
    modal(opts) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      if (opts.title) overlay.setAttribute('aria-label', opts.title);

      const actionsHTML = (opts.actions || [])
        .map(
          (a, i) =>
            `<button type="button" class="btn btn-${a.kind || 'ghost'}" data-act="${i}">${u.esc(a.label)}</button>`
        )
        .join('');

      overlay.innerHTML = `
        <div class="modal" role="document">
          ${opts.title ? `<h3 class="modal-title">${u.esc(opts.title)}</h3>` : ''}
          <div class="modal-body">${opts.bodyHTML || ''}</div>
          ${actionsHTML ? `<div class="modal-actions">${actionsHTML}</div>` : ''}
        </div>`;

      function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Escape' && opts.dismissible !== false) close();
      }
      document.addEventListener('keydown', onKey);

      (opts.actions || []).forEach((a, i) => {
        overlay.querySelector(`[data-act="${i}"]`).addEventListener('click', () => {
          if (a.onClick) a.onClick(close);
          else close();
        });
      });

      if (opts.dismissible !== false) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) close();
        });
      }

      document.body.appendChild(overlay);
      const firstBtn = overlay.querySelector('.modal-actions .btn') || overlay.querySelector('button, input, textarea');
      if (firstBtn) firstBtn.focus();
      return close;
    },

    confirm(title, bodyText, onYes) {
      ui.modal({
        title,
        bodyHTML: `<p class="modal-text">${u.esc(bodyText)}</p>`,
        actions: [
          { label: '取消', kind: 'ghost' },
          { label: '确定', kind: 'danger', onClick: (close) => { close(); onYes(); } },
        ],
      });
    },

    /** 轻提示 */
    toast(msg) {
      let holder = document.querySelector('.toast-holder');
      if (!holder) {
        holder = document.createElement('div');
        holder.className = 'toast-holder';
        holder.setAttribute('aria-live', 'polite');
        document.body.appendChild(holder);
      }
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = msg;
      holder.appendChild(t);
      setTimeout(() => t.classList.add('toast-show'), 10);
      setTimeout(() => {
        t.classList.remove('toast-show');
        setTimeout(() => t.remove(), 400);
      }, 2200);
    },
  };

  SJ.ui = ui;
})();
