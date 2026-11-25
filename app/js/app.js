/* 思迹 · 应用外壳与路由（Hash Router） */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const u = SJ.util;

  const routes = {
    home: /^#\/new$/,
    workspace: /^#\/s\/([^/]+)$/,
    path: /^#\/s\/([^/]+)\/path$/,
    detail: /^#\/s\/([^/]+)\/detail$/,
    history: /^#\/history$/,
    settings: /^#\/settings$/,
    light: /^#\/light$/,
    delidata: /^#\/demo\/delidata$/,
  };

  function currentRoute() {
    const h = location.hash || '#/new';
    let m;
    if ((m = h.match(routes.workspace))) return { name: 'workspace', id: m[1] };
    if ((m = h.match(routes.path))) return { name: 'path', id: m[1] };
    if ((m = h.match(routes.detail))) return { name: 'detail', id: m[1] };
    if ((m = h.match(routes.history))) return { name: 'history' };
    if ((m = h.match(routes.settings))) return { name: 'settings' };
    if (h.match(routes.light)) return { name: 'light' };
    if (h.match(routes.delidata)) return { name: 'delidata' };
    return { name: 'home' };
  }

  let disposeView = null;

  function renderShell() {
    if (disposeView) {
      disposeView();
      disposeView = null;
    }
    const app = document.getElementById('app');
    const r = currentRoute();
    const sessions = SJ.store.listSessions();

    if (r.name === 'light' || r.name === 'delidata') {
      app.innerHTML = '<main id="main" class="light-field-main" tabindex="-1"></main>';
      const main = document.getElementById('main');
      document.title = r.name === 'delidata' ? 'DeliData 公开会话 · 思迹' : '光影 · 思迹';
      if (r.name === 'delidata' || !sessions[0]) {
        SJ.publicDeliData.createSession().then((publicSession) => {
          if (currentRoute().name !== r.name) return;
          disposeView = SJ.views.lightfield(main, publicSession) || null;
        }).catch((error) => {
          main.innerHTML = '<section style="padding:48px;color:#d5dde2"><h1>公开案例暂时无法加载</h1><p>' + u.esc(error.message) + '</p><a href="#/new" style="color:#a9cbc1">返回新思考</a></section>';
        });
      } else {
        disposeView = SJ.views.lightfield(main, sessions[0]) || null;
      }
      return;
    }

    const active = (name) => (r.name === name ? 'is-active' : '');
    app.innerHTML = `
      <a class="skip-link" href="#main">跳到主要内容</a>
      <header class="site-header">
        <div class="wrap header-inner">
          <a class="brand" href="#/new">思迹</a>
          <nav class="site-nav" aria-label="主导航">
            <a href="#/new" class="${active('home')}">新思考</a>
            <a href="#/history" class="${['history', 'workspace', 'path', 'detail'].includes(r.name) ? 'is-active' : ''}">记录</a>
            <a href="#/light" class="${active('light')}">光影</a>
            <a href="#/settings">设置</a>
          </nav>
          <div class="header-badge">${SJ.ui.sourceBadge()}</div>
        </div>
      </header>
      <main id="main" class="wrap main" tabindex="-1"></main>
      <footer class="site-footer">
        <div class="wrap">
          <p>数据保存在${u.esc(SJ.store.dataLocation())}。</p>
          <p class="footer-motto">先留痕，再澄清，后回答。</p>
        </div>
      </footer>`;

    const main = document.getElementById('main');
    switch (r.name) {
      case 'workspace': {
        const s = SJ.store.getSession(r.id);
        if (!s) { location.hash = '#/history'; return; }
        SJ.views.workspace(main, s);
        break;
      }
      case 'path': {
        const s = SJ.store.getSession(r.id);
        if (!s) { location.hash = '#/history'; return; }
        SJ.views.path(main, s);
        break;
      }
      case 'detail': {
        const s = SJ.store.getSession(r.id);
        if (!s) { location.hash = '#/history'; return; }
        SJ.views.detail(main, s);
        break;
      }
      case 'history':
        SJ.views.history(main);
        break;
      case 'settings':
        SJ.views.settings(main);
        break;
      default:
        SJ.views.home(main, sessions);
    }
    document.title = '思迹 · AI 提问澄清与想法留痕';
  }

  SJ.app = { render: renderShell, route: currentRoute };

  window.addEventListener('hashchange', renderShell);
  window.addEventListener('DOMContentLoaded', renderShell);
  if (document.readyState !== 'loading') renderShell();
})();
