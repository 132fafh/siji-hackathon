'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/[...path].js');

test('云函数保留 API 与插件模拟页路由，静态发布目录完整', async (t) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'app');
  for (const file of ['index.html', 'project-brief.html', 'watch-demo.html', 'siji-live-demo.mp4']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'app', file)), true, file);
  }
  const server = http.createServer((req, res) => {
    req.query = { path: req.url.split('?')[0].split('/').filter(Boolean).slice(1) };
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  const expanded = await fetch(`${base}/api/expand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node: { text: '检验边界', kind: 'idea' }, action: 'alternatives', count: 2, existingCandidates: [] }),
  });
  assert.equal(expanded.status, 200);
  const result = await expanded.json();
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].sourceOrigin, 'ai');
  const mock = await fetch(`${base}/api/mock-kimi.html`);
  assert.equal(mock.status, 200);
  assert.match(await mock.text(), /思迹/);
});

test('Cloudflare Pages 函数实际处理五个 API，静态模拟页与本地一致', async () => {
  const { pathToFileURL } = require('node:url');
  const cloudFunction = await import(pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '[[path]].js')).href);
  const healthResponse = await cloudFunction.onRequest({ request: new Request('https://siji-hackathon.pages.dev/api/health'), env: {} });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'demo');
  const draft = '我想把刚才的思路保留下来，但还不知道怎样继续。';
  const cases = {
    restate: { draft },
    hints: { draft },
    expand: { node: { text: '检验边界', kind: 'idea' }, action: 'alternatives', count: 2, existingCandidates: [] },
    recall: { draft, userMessages: [{ id: 'public-1', text: '保留刚才的思路，再继续澄清。', timestamp: 1 }] },
    answer: { draft, question: '怎样保留刚才的思路？' },
  };
  for (const [name, body] of Object.entries(cases)) {
    const response = await cloudFunction.onRequest({
      request: new Request(`https://siji-hackathon.pages.dev/api/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8141' },
        body: JSON.stringify(body),
      }),
      env: {},
    });
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8141');
    const data = await response.json();
    assert.equal(data.demo, true, name);
    if (name === 'expand') assert.equal(data.candidates.length, 2);
    if (name === 'restate') assert.ok(data.restatement.length <= 100);
    if (name === 'recall') assert.equal(data.evidence[0].id, 'public-1');
  }
  assert.equal(
    fs.readFileSync(path.join(__dirname, '..', 'app', 'mock-kimi.html'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'server', 'mock-kimi.html'), 'utf8')
  );
});
