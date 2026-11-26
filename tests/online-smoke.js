'use strict';

const assert = require('node:assert/strict');

const base = (process.env.SIJI_BASE_URL || 'https://siji-hackathon.pages.dev').replace(/\/+$/, '');

async function request(path, options) {
  const response = await fetch(base + path, Object.assign({ signal: AbortSignal.timeout(30000) }, options));
  assert.equal(response.status, 200, `${path} 返回 ${response.status}`);
  return response;
}

async function main() {
  const health = await request('/api/health').then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.service, 'siji-demo-server');
  console.log(`健康检查：${health.mode}`);

  const draft = '我想保留刚才的思路，再决定下一步怎样澄清。';
  const cases = {
    restate: { draft },
    hints: { draft },
    expand: { node: { text: '检验边界', kind: 'idea' }, action: 'alternatives', count: 2, existingCandidates: [] },
    recall: { draft, userMessages: [{ id: 'online-public-1', text: '保留刚才的思路，再继续澄清。', timestamp: 1 }] },
    answer: { draft, question: '怎样保留刚才的思路？' },
  };
  for (const [name, body] of Object.entries(cases)) {
    const response = await request(`/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.match(response.headers.get('content-type') || '', /application\/json/, name);
    const data = await response.json();
    assert.equal(data.demo, true, `${name} 应明确标注默认演示`);
    if (name === 'restate') assert.ok(data.restatement.length <= 100);
    if (name === 'hints') assert.equal(data.hints.length, 3);
    if (name === 'expand') {
      assert.equal(data.candidates.length, 2);
      assert.ok(data.candidates.every((candidate) => candidate.sourceOrigin === 'ai'));
    }
    if (name === 'recall') assert.equal(data.evidence[0].id, 'online-public-1');
    if (name === 'answer') {
      for (const field of ['facts', 'assumptions', 'missing', 'next']) assert.ok(data[field].length > 0, field);
    }
    console.log(`API ${name}：200，演示标识有效`);
  }

  for (const [path, expected] of [
    ['/?v=boundary', '<title>思迹'],
    ['/js/app.js', 'window.SJ'],
    ['/project-brief.html', 'https://github.com/132fafh/siji-hackathon'],
    ['/watch-demo.html', 'https://www.bilibili.com/video/BV1LQykzCEih'],
    ['/mock-kimi.html', '模拟 Kimi'],
  ]) {
    const response = await request(path);
    assert.match(await response.text(), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), path);
    console.log(`页面 ${path}：可访问`);
  }
  const video = await request('/siji-live-demo.mp4');
  assert.match(video.headers.get('content-type') || '', /video\/mp4/);
  assert.ok((await video.arrayBuffer()).byteLength > 1000000);
  console.log('69 秒录屏：视频类型与文件大小有效');
  console.log(`线上验收通过：${base}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
