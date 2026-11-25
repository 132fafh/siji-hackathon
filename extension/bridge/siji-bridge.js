/* 思迹 · 扩展一次性交接桥（仅由扩展注入，普通页面不加载） */
(function () {
  'use strict';

  const HANDOFF_KEY = 'sijiHandoff';
  const SESSIONS_KEY = 'siji.sessions';
  const COUNTER_KEY = 'siji.counter';
  const STATE_KEY = '__sijiBridgeState__';
  const state = window[STATE_KEY] || { phase: 'idle' };
  window[STATE_KEY] = state;

  function notify(message) {
    const note = document.createElement('div');
    note.setAttribute('role', 'status');
    note.textContent = message;
    note.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;padding:12px 16px;background:#2e2c26;color:#fff;border-radius:8px;text-align:center;';
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 5000);
  }

  function fail(message) {
    state.phase = 'error';
    state.message = message;
    notify(message);
  }

  function lastError() {
    return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.lastError : null;
  }

  function auxiliaryContext(payload) {
    return {
      userMessages: (Array.isArray(payload.userMessages) ? payload.userMessages : [])
        .filter((message) => message && typeof message.id === 'string' && typeof message.text === 'string' && message.text.trim())
        .slice(-20)
        .map((message) => ({
          id: message.id,
          text: message.text,
          timestamp: Number.isFinite(message.timestamp) ? message.timestamp : 0,
        })),
      sourceUrl: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : '',
      createdAt: Number.isFinite(payload.createdAt) ? payload.createdAt : 0,
    };
  }

  function makeTitle(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 18 ? compact.slice(0, 18) + '…' : compact || '未命名思考';
  }

  function createSession(payload) {
    const now = Date.now();
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    const counter = (parseInt(localStorage.getItem(COUNTER_KEY) || '0', 10) || 0) + 1;
    const draft = payload.draft.trim();
    const session = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 8),
      title: `思考 #${counter} · ${makeTitle(draft)}`,
      createdAt: now,
      updatedAt: now,
      status: 'clarifying',
      original: { text: draft, ts: now },
      rounds: [],
      misunderstandings: [],
      blanks: [],
      confirmed: null,
      answer: null,
      aiSource: 'demo',
      pluginContext: auxiliaryContext(payload),
    };
    sessions.push(session);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(COUNTER_KEY, String(counter));
    return session;
  }

  function receive() {
    if (state.phase !== 'idle') return;
    state.phase = 'reading';

    const storage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (!storage || typeof storage.get !== 'function' || typeof storage.remove !== 'function') {
      fail('扩展交接暂不可用，请从扩展重新进入思迹。');
      return;
    }

    try {
      storage.get(HANDOFF_KEY, (items) => {
        if (lastError()) {
          fail('没有读到交接内容，请回到原页面重试。');
          return;
        }
        const payload = items && items[HANDOFF_KEY];
        if (!payload || typeof payload.draft !== 'string' || !payload.draft.trim()) {
          state.phase = 'done';
          location.hash = '#/new';
          notify('没有接收到草稿，可以直接写下现在的想法。');
          return;
        }

        state.phase = 'creating';
        storage.remove(HANDOFF_KEY, () => {
          if (lastError()) {
            fail('一次性交接未能完成，请回到原页面重试。');
            return;
          }
          let session;
          try {
            session = createSession(payload);
            state.phase = 'done';
          } catch (error) {
            fail('草稿保存失败，请检查浏览器存储空间后重试。');
            return;
          }
          location.hash = `#/s/${session.id}`;
          notify('草稿已留痕，近期对话仅作为辅助上下文。');
        });
      });
    } catch (error) {
      fail('扩展交接暂不可用，请回到原页面重试。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', receive, { once: true });
  } else {
    receive();
  }
})();
