'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function backgroundWithState(initial) {
  const data = Object.assign({}, initial);
  const sent = [];
  global.importScripts = () => {};
  global.SijiSiteAdapters = require('../shared/site-adapters.js');
  global.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { this.listener = fn; } }
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = typeof keys === 'string' ? { [keys]: data[keys] } : Object.fromEntries(keys.map((key) => [key, data[key]]));
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        async set(patch) { Object.assign(data, patch); }
      }
    },
    tabs: { async sendMessage(id, message) { sent.push({ id, message }); }, async get(id) { return { id, url: 'https://www.kimi.com/chat' }; } }
  };
  delete require.cache[require.resolve('../background.js')];
  require('../background.js');
  return { data, sent, listener: global.chrome.runtime.onMessage.listener };
}

test('内置站点停用后不会启用，手动恢复又可启用', async () => {
  const { data, listener } = backgroundWithState({ sijiDisabledHosts: ['www.kimi.com'] });
  const call = (message, tab) => new Promise((resolve) => listener(message, { tab }, resolve));
  const tab = { id: 1, url: 'https://www.kimi.com/chat' };
  const disabled = await call({ type: 'getSijiSiteStatus' }, tab);
  assert.equal(disabled.enabled, false);
  const enabled = await call({ type: 'toggleSijiSite' }, tab);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(data.sijiDisabledHosts, []);
  const disabledAgain = await call({ type: 'toggleSijiSite' }, tab);
  assert.equal(disabledAgain.enabled, false);
  assert.deepEqual(data.sijiDisabledHosts, ['www.kimi.com']);
});

test('未知站点只有切换后才加入启用列表', async () => {
  const { data, listener, sent } = backgroundWithState({ sijiEnabledHosts: [] });
  const call = (message, tab) => new Promise((resolve) => listener(message, { tab }, resolve));
  const tab = { id: 2, url: 'https://example.com/chat' };
  const before = await call({ type: 'getSijiSiteStatus' }, tab);
  assert.equal(before.enabled, false);
  assert.equal(before.builtIn, false);
  const enabled = await call({ type: 'toggleSijiSite' }, tab);
  assert.equal(enabled.enabled, true);
  assert.deepEqual(data.sijiEnabledHosts, ['example.com']);
  assert.equal(sent[0].message.enabled, true);
  const disabled = await call({ type: 'toggleSijiSite' }, tab);
  assert.equal(disabled.enabled, false);
  assert.deepEqual(data.sijiEnabledHosts, []);
});

test('弹窗消息可通过 tabId 获取当前站点', async () => {
  const { listener } = backgroundWithState({ sijiDisabledHosts: ['www.kimi.com'] });
  const result = await new Promise((resolve) => listener({ type: 'getSijiSiteStatus', tabId: 7 }, {}, resolve));
  assert.equal(result.ok, true);
  assert.equal(result.hostname, 'www.kimi.com');
  assert.equal(result.enabled, false);
});
