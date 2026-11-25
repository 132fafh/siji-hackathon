/* 思迹 · 本地数据层（localStorage 本地优先）
 *
 * 存储位置：当前浏览器 localStorage
 *   - siji.sessions : 全部思考记录（JSON 数组）
 *   - siji.settings : AI 服务配置等
 *   - siji.counter  : 序号（用于默认标题）
 * 原始表达（session.original）一经写入不可被 AI 或任何流程修改。
 */
(function () {
  const SJ = (window.SJ = window.SJ || {});
  const KEY_SESSIONS = 'siji.sessions';
  const KEY_SETTINGS = 'siji.settings';
  const KEY_COUNTER = 'siji.counter';

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('[思迹] 读取本地数据失败:', key, e);
      return fallback;
    }
  }

  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  const store = {
    /* ---------- 设置 ---------- */
    getSettings() {
      return Object.assign(
        { mode: 'demo', baseUrl: '', model: '', apiKey: '' },
        readJSON(KEY_SETTINGS, {})
      );
    },

    saveSettings(patch) {
      const next = Object.assign(store.getSettings(), patch);
      writeJSON(KEY_SETTINGS, next);
      return next;
    },

    /* ---------- 会话 ---------- */
    listSessions() {
      const list = readJSON(KEY_SESSIONS, []);
      // 新的在前；时间完全相同时按写入顺序（后写入的在前），保证稳定
      return list
        .map((s, i) => [s, i])
        .sort((a, b) => b[0].updatedAt - a[0].updatedAt || b[1] - a[1])
        .map((x) => x[0]);
    },

    getSession(id) {
      return store.listSessions().find((s) => s.id === id) || null;
    },

    _nextNo() {
      const n = (parseInt(localStorage.getItem(KEY_COUNTER) || '0', 10) || 0) + 1;
      localStorage.setItem(KEY_COUNTER, String(n));
      return n;
    },

    /** 新建一次思考。originalText 为不可变的原始表达。 */
    createSession(originalText) {
      const now = Date.now();
      const sessions = readJSON(KEY_SESSIONS, []);
      const session = {
        id: SJ.util.uid(),
        title: `思考 #${store._nextNo()} · ${SJ.util.makeTitle(originalText)}`,
        createdAt: now,
        updatedAt: now,
        status: 'clarifying', // clarifying | confirmed | answered | blank
        original: { text: String(originalText).trim(), ts: now }, // 不可变
        rounds: [],
        misunderstandings: [], // 用户否定过的 AI 理解
        blanks: [], // { startedAt, option, resumedAt, verdict }
        confirmed: null, // { text, ts }
        answer: null, // { facts, assumptions, missing, next, ts, feedback }
        aiSource: 'demo', // demo | api（记录本次实际使用的 AI 来源）
      };
      sessions.push(session);
      writeJSON(KEY_SESSIONS, sessions);
      return session;
    },

    /** 局部更新会话并保存（original 字段在 UI 层即被保护，此处再兜底一次）。 */
    updateSession(id, patch) {
      const sessions = readJSON(KEY_SESSIONS, []);
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const safe = Object.assign({}, patch);
      delete safe.original; // 原始表达永不被覆盖
      delete safe.id;
      delete safe.createdAt;
      const next = Object.assign({}, sessions[idx], safe, { updatedAt: Date.now() });
      sessions[idx] = next;
      writeJSON(KEY_SESSIONS, sessions);
      return next;
    },

    renameSession(id, title) {
      const t = String(title || '').trim();
      if (!t) return null;
      return store.updateSession(id, { title: t.slice(0, 60) });
    },

    deleteSession(id) {
      writeJSON(KEY_SESSIONS, readJSON(KEY_SESSIONS, []).filter((s) => s.id !== id));
    },

    /* ---------- 数据管理 ---------- */
    dataLocation() {
      return '当前浏览器的 localStorage（仅本机可见，不默认上传）';
    },

    clearAll() {
      localStorage.removeItem(KEY_SESSIONS);
      localStorage.removeItem(KEY_COUNTER);
    },

    exportJSON() {
      return JSON.stringify(
        { app: '思迹', version: 1, exportedAt: new Date().toISOString(), sessions: store.listSessions() },
        null,
        2
      );
    },
  };

  SJ.store = store;
})();
