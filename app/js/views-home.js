/* 思迹 · 首页 / 新思考页 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;

  SJ.views = SJ.views || {};

  SJ.views.home = function (main, sessions) {
    const recent = sessions.slice(0, 3);

    main.innerHTML = `
      <section class="hero">
        <h1 class="hero-title">现在脑子里有什么？</h1>
        <p class="hero-sub">不用组织语言，直接写下来。</p>
        <form id="new-thought" class="composer">
          <label class="sr-only" for="raw-input">原始想法</label>
          <textarea id="raw-input" rows="5" maxlength="5000"
            placeholder="想到哪写到哪，错别字、碎片、矛盾的句子都可以。"></textarea>
          <div class="composer-foot">
            <p class="composer-note">提交后，这段话会被原样保存，任何 AI 都不能修改它。</p>
            <button type="submit" class="btn btn-primary btn-lg">先留下来</button>
          </div>
        </form>
      </section>

      ${recent.length ? `
      <section class="recent" aria-label="最近的思考">
        <div class="section-head">
          <h2>最近的思考</h2>
          <a href="#/history" class="link-muted">全部记录 →</a>
        </div>
        <ul class="recent-list">
          ${recent
            .map(
              (s) => `
            <li>
              <a class="recent-item" href="#/s/${s.id}">
                <span class="recent-title">${u.esc(s.title)}</span>
                <span class="recent-meta">${u.relTime(s.updatedAt)} · ${statusLabel(s.status)}</span>
              </a>
            </li>`
            )
            .join('')}
        </ul>
      </section>` : ''}`;

    const form = main.querySelector('#new-thought');
    const ta = main.querySelector('#raw-input');
    ta.focus();

    function submit() {
      const text = ta.value.trim();
      if (!text) {
        SJ.ui.toast('先写一点什么都可以');
        ta.focus();
        return;
      }
      const s = SJ.store.createSession(text);
      location.hash = '#/s/' + s.id;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
  };

  function statusLabel(st) {
    return { clarifying: '澄清中', confirmed: '已确认问题', answered: '已有回答' }[st] || '澄清中';
  }
  SJ.views.statusLabel = statusLabel;
})();
