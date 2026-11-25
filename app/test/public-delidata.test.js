'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');

global.window = global;
require('../js/public-delidata.js');

test('公开演示由网上 DeliData 的 15 条原始发言构成', async () => {
  const session = await SJ.publicDeliData.createSession(async () => ({ ok: true, json: async () => fixture }));
  const lines = session.original.text.split('\n');
  assert.equal(lines.length, 15);
  assert.deepEqual(lines, fixture.turns.map((turn) => turn.speaker + ': ' + turn.text));
  assert.equal(session.demoPublicCase, true);
  assert.equal(session.publicSource.url, 'https://arxiv.org/html/2108.05271v3');
  assert.equal(session.publicSource.location.includes('Table 12'), true);
});

test('前端打包的 JSON 与原始研究案例逐字一致', () => {
  const bundled = fs.readFileSync(path.join(__dirname, '..', 'demo-data', 'delidata-wason-constructive.json'), 'utf8');
  assert.deepEqual(JSON.parse(bundled), fixture);
});

test('公开路由和加载器存在，不经过本地历史存储创建会话', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const light = fs.readFileSync(path.join(__dirname, '..', 'js', 'views-lightfield.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /#\\\/demo\\\/delidata/);
  assert.match(app, /publicDeliData\.createSession/);
  assert.match(light, /demoPublicCase/);
  assert.match(light, /if \(!session\.demoPublicCase\) SJ\.store\.updateSession/);
  assert.match(html, /public-delidata\.js/);
});
