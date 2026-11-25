'use strict';

const assert = require('assert/strict');
const http = require('http');
const { createServer } = require('./server');
const { createAIService } = require('./ai-service');

let passed = 0;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(base, pathname, body) {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function mockCase(name, responder, verify, options) {
  const requests = [];
  const mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ url: req.url, authorization: req.headers.authorization, body });
      const result = await responder(body, requests.length);
      if (result.delay) await delay(result.delay);
      if (res.destroyed) return;
      res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.status && result.status !== 200 ? { error: 'mock failure' } : {
        choices: [{ message: { content: result.content } }],
      }));
    });
  });

  let app;
  try {
    await listen(mock);
    const mockBase = `http://127.0.0.1:${mock.address().port}`;
    const opts = options || {};
    const aiService = createAIService({
      apiBase: `${mockBase}/v1`,
      apiKey: 'test-only-not-a-secret',
      model: 'local-test-model',
      timeoutMs: opts.timeoutMs || 500,
    });
    app = createServer({ aiService });
    await listen(app);
    await verify(`http://127.0.0.1:${app.address().port}`, requests);
    passed += 1;
    console.log(`  ✓ ${name}`);
  } finally {
    if (app) await close(app);
    await close(mock);
  }
}

async function run() {
  await mockCase('五个 API 均走真实模型成功路径，扩展保持候选身份，recall 证据不可被模型改写', (body) => {
    const task = body.messages[1] ? JSON.parse(body.messages[1].content).task : '';
    if (task === 'restate') return { content: '{"restatement":"我暂时理解为你在整理选择，这是推测，你可以纠正。"}' };
    if (task === 'hints') return { content: JSON.stringify({ hints: [
      { type: '留词', text: '留下一个词。' },
      { type: '经验', text: '回想一个场景。' },
      { type: '关系', text: '写一个关系。' },
    ] }) };
    if (task === 'expand') return { content: JSON.stringify({ candidates: [
      { text: '检查这个方案成立所需的前提。', kind: 'premise', style: 'concrete' },
      { text: '寻找一个不采用第三张牌的替代方案。', kind: 'idea', style: 'abstract' },
    ] }) };
    if (task === 'recall') return { content: JSON.stringify({
      evidence: [{ id: 'fabricated-id', text: '伪造来源', score: 100 }],
      aiAdditions: ['也许可以把这段原话和当前草稿对照。'],
    }) };
    return { content: JSON.stringify({
      facts: ['API事实：草稿提到了自由职业。'],
      assumptions: ['这是一种可纠正的推测。'],
      missing: ['还缺少具体时间。'],
      next: ['先验证一个最小假设。'],
    }) };
  }, async (base, requests) => {
    const restate = await post(base, '/api/restate', { draft: '我在考虑自由职业。' });
    assert.equal(restate.demo, false);
    assert.equal(restate.mode, 'api');
    assert.deepEqual(restate.meta, { actualMode: 'api', fallback: false, reason: null });
    assert.match(restate.restatement, /暂时理解/);

    const hints = await post(base, '/api/hints', { draft: '我在考虑自由职业。' });
    assert.equal(hints.hints.length, 3);
    assert.ok(hints.hints.every((hint) => hint.demo === false));
    assert.equal(hints.meta.actualMode, 'api');

    const fixture = require('../tests/fixtures/delidata-wason-constructive.json');
    const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
    const expansion = await post(base, '/api/expand', {
      node: { text: source.text, kind: 'idea' },
      action: 'challenge',
      preferences: { style: 'concrete' },
      count: 2,
    });
    assert.equal(expansion.meta.actualMode, 'api');
    assert.equal(expansion.demo, false);
    assert.equal(expansion.candidates.length, 2);
    assert.equal(expansion.candidates[0].kind, 'premise');
    assert.ok(expansion.candidates.every((candidate) => candidate.demo === false && candidate.sourceOrigin === 'ai' && candidate.action === 'challenge'));

    const original = '我担心自由职业收入不稳定。';
    const recall = await post(base, '/api/recall', {
      draft: '自由职业收入怎么办',
      userMessages: [{ id: 'user-real', text: original }],
    });
    assert.equal(recall.meta.actualMode, 'api');
    assert.equal(recall.evidence[0].id, 'user-real');
    assert.equal(recall.evidence[0].text, original);
    assert.ok(recall.evidence[0].score > 0);
    assert.ok(recall.aiAdditions[0].includes('推测'));
    assert.doesNotMatch(JSON.stringify(recall), /fabricated-id|伪造来源/);
    assert.match(recall.uncertainty, /不是用户原话/);

    const noMatch = await post(base, '/api/recall', {
      draft: '量子计算',
      userMessages: [{ id: 'user-other', text: '我喜欢苹果' }],
    });
    assert.deepEqual(noMatch.evidence, []);
    assert.deepEqual(noMatch.aiAdditions, []);

    const answer = await post(base, '/api/answer', { draft: '我在考虑自由职业。' });
    assert.equal(answer.meta.actualMode, 'api');
    assert.equal(answer.facts[0], 'API事实：草稿提到了自由职业。');
    ['facts', 'assumptions', 'missing', 'next'].forEach((key) => assert.ok(answer[key].length > 0));

    assert.equal(requests.length, 6);
    requests.forEach((request) => {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.authorization, 'Bearer test-only-not-a-secret');
      assert.equal(request.body.model, 'local-test-model');
      assert.match(request.body.messages[0].content, /不诊断/);
      assert.match(request.body.messages[0].content, /不测量 IQ/);
      assert.match(request.body.messages[0].content, /可纠正/);
    });
  });

  await mockCase('上游 HTTP 错误自动回退 demo 并给出安全原因', () => ({ status: 503, content: '' }), async (base) => {
    const result = await post(base, '/api/restate', { draft: '测试错误回退' });
    assert.equal(result.demo, true);
    assert.equal(result.meta.actualMode, 'demo');
    assert.equal(result.meta.fallback, true);
    assert.match(result.meta.reason, /AI_HTTP_ERROR/);
    assert.match(result.meta.reason, /503/);
    assert.match(result.restatement, /演示/);
    assert.doesNotMatch(result.meta.reason, /test-only-not-a-secret/);
  });

  await mockCase('模型 JSON 容忍前置说明与 Markdown 代码围栏', () => ({
    content: '以下是结果：\n```json\n{"restatement":"我暂时理解为你在寻找下一步，这是推测。"}\n```',
  }), async (base) => {
    const result = await post(base, '/api/restate', { draft: '下一步是什么' });
    assert.equal(result.meta.actualMode, 'api');
    assert.equal(result.meta.fallback, false);
    assert.match(result.restatement, /寻找下一步/);
  });

  await mockCase('模型内容不是 JSON 时回退 demo', () => ({ content: '这不是 JSON' }), async (base) => {
    const result = await post(base, '/api/answer', { draft: '测试解析失败' });
    assert.equal(result.demo, true);
    assert.equal(result.meta.actualMode, 'demo');
    assert.equal(result.meta.fallback, true);
    assert.match(result.meta.reason, /AI_INVALID_JSON/);
    assert.ok(result.facts.length > 0);
  });

  await mockCase('真实模型请求超时后回退 demo', () => ({
    delay: 150,
    content: '{"restatement":"迟到的响应不应被采用。"}',
  }), async (base) => {
    const result = await post(base, '/api/restate', { draft: '测试超时' });
    assert.equal(result.demo, true);
    assert.equal(result.meta.actualMode, 'demo');
    assert.equal(result.meta.fallback, true);
    assert.match(result.meta.reason, /AI_TIMEOUT/);
    assert.match(result.restatement, /演示/);
  }, { timeoutMs: 30 });

  console.log(`\n通过 ${passed} 组本地 mock OpenAI 测试，未访问真实外网。`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
