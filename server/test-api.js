'use strict';

const assert = require('assert/strict');
const { createServer, MAX_BODY_BYTES } = require('./server');

let passed = 0;

function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

async function jsonRequest(base, pathname, body, options) {
  const opts = options || {};
  const response = await fetch(base + pathname, {
    method: opts.method || 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.method === 'GET' ? undefined : (opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(body)),
  });
  const value = await response.json();
  return { response, value };
}

async function run() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  console.log(`测试服务已启动：${base}`);

  try {
    await check('GET /api/health 返回健康与 demo 状态、localhost CORS', async () => {
      const response = await fetch(base + '/api/health', { headers: { Origin: 'http://localhost:8141' } });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.demo, true);
      assert.equal(body.mode, 'demo');
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8141');
    });

    await check('静态首页与扩展桥接文件可访问', async () => {
      const home = await fetch(base + '/');
      const html = await home.text();
      assert.equal(home.status, 200);
      assert.match(home.headers.get('content-type'), /^text\/html/);
      assert.match(html, /思迹/);
      assert.match(html, /仅由扩展/);
      const bridge = await fetch(base + '/bridge/siji-bridge.js');
      assert.equal(bridge.status, 200);
      assert.match(await bridge.text(), /sijiHandoff/);
    });

    await check('数据验证页不作为公开产品页面提供', async () => {
      const response = await fetch(base + '/growth-validation.html');
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /边界拓展数据验证/);
    });

    await check('mock-kimi.html 含消息区、输入框与滚动长历史', async () => {
      const response = await fetch(base + '/mock-kimi.html');
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /id="messages"/);
      assert.match(html, /id="prompt-input"/);
      assert.match(html, /overflow-y: auto/);
      assert.ok((html.match(/class="message ai/g) || []).length >= 5);
    });

    await check('POST /api/restate 返回明确标注的演示复述', async () => {
      const { response, value } = await jsonRequest(base, '/api/restate', { draft: '我想辞职做自由职业，但担心收入不稳定。' });
      assert.equal(response.status, 200);
      assert.equal(value.demo, true);
      assert.match(value.restatement, /演示/);
      assert.ok(value.restatement.length <= 100);
    });

    await check('POST /api/hints 返回三个演示提示', async () => {
      const { response, value } = await jsonRequest(base, '/api/hints', { draft: '县城青年的小说一直开不了头', offset: 1 });
      assert.equal(response.status, 200);
      assert.equal(value.demo, true);
      assert.equal(value.hints.length, 3);
      assert.ok(value.hints.every((hint) => hint.demo && hint.type && hint.text));
    });

    await check('POST /api/expand 使用公开会话返回明确标注的演示候选并拒绝非法扩展', async () => {
      const fixture = require('../tests/fixtures/delidata-wason-constructive.json');
      const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
      const turn = fixture.turns.find((item) => item.id === source.sourceTurnId);
      const { response, value } = await jsonRequest(base, '/api/expand', {
        node: { text: source.text, kind: 'idea', sourceQuote: turn.text },
        action: 'alternatives',
        count: 2,
        preferences: { style: 'concrete', count: 2 },
      });
      assert.equal(response.status, 200);
      assert.equal(value.demo, true);
      assert.equal(value.meta.actualMode, 'demo');
      assert.equal(value.candidates.length, 2);
      assert.equal(value.candidates[0].style, 'concrete');
      assert.ok(value.candidates.every((candidate) => candidate.demo && candidate.sourceOrigin === 'ai' && candidate.action === 'alternatives'));
      assert.match(value.notice, /不是真实 AI/);
      const paused = await jsonRequest(base, '/api/expand', {
        node: { text: source.text, kind: 'idea', sourceQuote: turn.text },
        action: 'project',
        count: 0,
      });
      assert.equal(paused.response.status, 200);
      assert.equal(paused.value.candidates.length, 0);
      assert.match(paused.value.reason, /B=0/);
      const repeated = await jsonRequest(base, '/api/expand', {
        node: { text: source.text, kind: 'idea', sourceQuote: turn.text },
        action: 'alternatives',
        count: 2,
        preferences: { style: 'concrete', count: 2 },
        existingCandidates: value.candidates,
      });
      assert.equal(repeated.response.status, 200);
      assert.equal(repeated.value.candidates.length, 2);
      assert.ok(repeated.value.skippedDuplicates.length > 0);
      const firstTexts = value.candidates.map((candidate) => candidate.text);
      assert.ok(repeated.value.candidates.every((candidate) => !firstTexts.includes(candidate.text)), '再次扩展不得返回旧候选');
      const exhausted = await jsonRequest(base, '/api/expand', {
        node: { text: source.text, kind: 'idea', sourceQuote: turn.text },
        action: 'alternatives',
        count: 2,
        preferences: { style: 'concrete', count: 2 },
        existingCandidates: value.candidates.concat(repeated.value.candidates, [
          { text: '如果不采用「' + source.text + '」，还有什么不同路径？' },
          { text: '「' + source.text + '」能否换成相反方向的尝试？' },
        ]),
      });
      assert.equal(exhausted.value.candidates.length, 0);
      assert.match(exhausted.value.reason, /不再重复生成/);
      const invalid = await jsonRequest(base, '/api/expand', {
        node: { text: '有个还说不出来的东西', kind: 'fragment' },
        action: 'project',
      });
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.value.error.code, 'EXPANSION_NOT_ALLOWED');
    });

    await check('POST /api/recall 返回原消息 ID、原文和可解释分数', async () => {
      const original = '我在考虑辞职做自由职业，担心收入不稳定。';
      const { response, value } = await jsonRequest(base, '/api/recall', {
        draft: '我想辞职做自由职业，又担心收入不稳定',
        userMessages: [
          { id: 'user-1', text: '我喜欢县城的生活。', timestamp: 1 },
          { id: 'user-2', text: original, timestamp: 2 },
        ],
      });
      assert.equal(response.status, 200);
      assert.equal(value.demo, true);
      assert.equal(value.evidence[0].id, 'user-2');
      assert.equal(value.evidence[0].text, original);
      assert.ok(value.evidence[0].score > 0 && value.evidence[0].score <= 100);
      assert.ok(value.cues.length > 0);
      assert.ok(value.aiAdditions.every((text) => text.includes('演示新增')));
      assert.match(value.uncertainty, /不表示真实遗忘概率/);
      assert.match(value.scoring, /Dice/);
    });

    await check('recall 无匹配时不编造证据、线索或 AI 新增', async () => {
      const { value } = await jsonRequest(base, '/api/recall', {
        draft: '探索量子计算',
        userMessages: [{ id: 'user-none', text: '我喜欢吃苹果' }],
      });
      assert.deepEqual(value.evidence, []);
      assert.deepEqual(value.cues, []);
      assert.deepEqual(value.aiAdditions, []);
      assert.match(value.uncertainty, /未找到/);
    });

    await check('POST /api/answer 返回 facts/assumptions/missing/next 四段', async () => {
      const { response, value } = await jsonRequest(base, '/api/answer', {
        draft: '想写一本关于县城青年的小说，但怕太私人。',
        question: '怎样先完成一篇同时保留隐私边界？',
      });
      assert.equal(response.status, 200);
      assert.equal(value.demo, true);
      ['facts', 'assumptions', 'missing', 'next'].forEach((key) => {
        assert.ok(Array.isArray(value[key]) && value[key].length > 0, key);
      });
      assert.match(value.facts[0], /县城青年/);
      assert.match(value.assumptions[0], /推测/);
    });

    await check('无效 JSON 与缺失 draft 返回明确错误格式', async () => {
      const invalid = await jsonRequest(base, '/api/restate', null, { rawBody: '{bad json' });
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.value.error.code, 'INVALID_JSON');
      assert.ok(invalid.value.error.message);
      const missing = await jsonRequest(base, '/api/restate', {});
      assert.equal(missing.response.status, 400);
      assert.equal(missing.value.error.code, 'INVALID_DRAFT');
    });

    await check('非对象 JSON 和非法 userMessages 被拒绝', async () => {
      const arrayBody = await jsonRequest(base, '/api/hints', []);
      assert.equal(arrayBody.response.status, 400);
      assert.equal(arrayBody.value.error.code, 'INVALID_INPUT');
      const messages = await jsonRequest(base, '/api/recall', { draft: '测试', userMessages: [{ id: 'bad' }] });
      assert.equal(messages.response.status, 400);
      assert.equal(messages.value.error.code, 'INVALID_MESSAGE_TEXT');
    });

    await check('非 JSON Content-Type 返回 415', async () => {
      const { response, value } = await jsonRequest(base, '/api/restate', null, {
        rawBody: 'draft=test',
        headers: { 'Content-Type': 'text/plain' },
      });
      assert.equal(response.status, 415);
      assert.equal(value.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    });

    await check('超过 64 KiB 的请求体返回 413', async () => {
      const { response, value } = await jsonRequest(base, '/api/restate', { draft: '字'.repeat(MAX_BODY_BYTES) });
      assert.equal(response.status, 413);
      assert.equal(value.error.code, 'BODY_TOO_LARGE');
    });

    await check('未知 API 与错误方法分别返回 404、405', async () => {
      const missing = await jsonRequest(base, '/api/not-found', {});
      assert.equal(missing.response.status, 404);
      assert.equal(missing.value.error.code, 'NOT_FOUND');
      const wrongMethod = await jsonRequest(base, '/api/restate', null, { method: 'GET', rawBody: undefined });
      assert.equal(wrongMethod.response.status, 405);
      assert.equal(wrongMethod.response.headers.get('allow'), 'POST');
    });

    await check('OPTIONS 允许 localhost，非 localhost 不获得 CORS 允许头', async () => {
      const local = await fetch(base + '/api/recall', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
      assert.equal(local.status, 204);
      assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3000');
      const remote = await fetch(base + '/api/health', { headers: { Origin: 'https://example.com' } });
      assert.equal(remote.headers.get('access-control-allow-origin'), null);
    });

    await check('目录穿越被拒绝且不泄露应用外文件', async () => {
      const response = await fetch(base + '/%2e%2e%2fARCHITECTURE.md');
      const text = await response.text();
      assert.equal(response.status, 403);
      assert.match(text, /目录穿越/);
      assert.doesNotMatch(text, /实现契约/);
      const backslash = await fetch(base + '/%2e%2e%5cARCHITECTURE.md');
      assert.equal(backslash.status, 400);
    });

    await check('中文 URL 可正常解码，目录不显示列表', async () => {
      const chinese = await fetch(base + '/%E4%B8%AD%E6%96%87%E8%B7%AF%E5%BE%84');
      assert.equal(chinese.status, 404);
      assert.match(await chinese.text(), /未找到文件/);
      const directory = await fetch(base + '/css/');
      assert.equal(directory.status, 404);
      assert.doesNotMatch(await directory.text(), /style\.css/);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n通过 ${passed} 组实际 HTTP 测试。`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
