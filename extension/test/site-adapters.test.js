'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const adapters = require('../shared/site-adapters.js');

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('内置主流 AI 与本地模拟站点适配器', () => {
  const expected = new Map([
    ['www.kimi.com', 'kimi'],
    ['chatgpt.com', 'chatgpt'],
    ['claude.ai', 'claude'],
    ['gemini.google.com', 'gemini'],
    ['chat.deepseek.com', 'deepseek'],
    ['www.doubao.com', 'doubao'],
    ['qianwen.com', 'qwen'],
    ['yuanbao.tencent.com', 'yuanbao'],
    ['chat.zhipu.cn', 'zhipu'],
    ['poe.com', 'poe'],
    ['www.perplexity.ai', 'perplexity'],
    ['copilot.microsoft.com', 'copilot'],
    ['chat.mistral.ai', 'mistral'],
    ['grok.com', 'grok'],
    ['localhost', 'mock']
  ]);
  expected.forEach((id, hostname) => {
    const adapter = adapters.detect({ hostname, href: 'https://' + hostname + '/chat' });
    assert.equal(adapter.id, id, hostname);
    assert.ok(adapter.editorSelector.includes('contenteditable') || adapter.editorSelector.includes('textarea'));
    assert.ok(adapter.messageSelector.includes('data-message-author-role'));
  });
});

test('域名匹配不会误伤相似或恶意后缀域名', () => {
  assert.equal(adapters.hostMatches('www.kimi.com', 'kimi.com'), true);
  assert.equal(adapters.hostMatches('chat.kimi.com', 'kimi.com'), true);
  assert.equal(adapters.hostMatches('kimi.com.evil.example', 'kimi.com'), false);
  assert.equal(adapters.detect({ hostname: 'example.com' }), null);
});

test('通用输入识别包含 textarea、文本输入、contenteditable 与 role textbox', () => {
  const selector = adapters.GENERIC_EDITOR_SELECTORS.join(',');
  assert.match(selector, /textarea/);
  assert.match(selector, /input\[type="text"]/);
  assert.match(selector, /contenteditable/);
  assert.match(selector, /role="textbox"/);
});

test('未识别站点只有手动启用后才返回通用适配器', async () => {
  const enabledHosts = ['example.com'];
  global.chrome = {
    storage: { local: { get(key, callback) { callback(key === 'sijiEnabledHosts' ? { sijiEnabledHosts: enabledHosts } : {}); } } },
    runtime: { lastError: null }
  };
  const enabled = await new Promise((resolve) => adapters.whenReady({ hostname: 'example.com', href: 'https://example.com/chat' }, resolve));
  assert.equal(enabled.id, 'custom');
  const disabled = await new Promise((resolve) => adapters.whenReady({ hostname: 'other.example', href: 'https://other.example/chat' }, resolve));
  assert.equal(disabled, null);
  delete global.chrome;
});

test('内置站点可以被手动停用', async () => {
  global.chrome = {
    storage: { local: { get(key, callback) { callback({ sijiDisabledHosts: ['www.kimi.com'] }); } } },
    runtime: { lastError: null }
  };
  const result = await new Promise((resolve) => adapters.whenReady({ hostname: 'www.kimi.com', href: 'https://www.kimi.com/' }, resolve));
  assert.equal(result, null);
  delete global.chrome;
});

test('manifest 声明通用注入、站点控制弹窗及适配器加载顺序', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(manifest.permissions.includes('activeTab'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('shared/site-adapters.js'));
  assert.ok(scripts.indexOf('shared/site-adapters.js') < scripts.indexOf('content/detector.js'));
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      result.then(() => console.log(`✓ ${name}`)).catch((error) => {
        failures += 1;
        console.error(`✗ ${name}`, error);
      });
    } else console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`, error);
  }
}
setTimeout(() => {
  console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
  if (failures) process.exitCode = 1;
}, 20);
