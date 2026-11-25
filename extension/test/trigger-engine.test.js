'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_SETTINGS,
  computeScore,
  shouldTrigger,
  isInCooldown
} = require('../shared/trigger-engine.js');

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

test('默认阈值是 60，空特征保持 100 分', () => {
  assert.equal(DEFAULT_SETTINGS.threshold, 60);
  const result = computeScore({});
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.featureSnapshot.draftLength, 0);
});

test('标准演示模式停顿约 10 秒降到阈值以下', () => {
  const early = computeScore({ pauseMs: 2000 });
  const paused = computeScore({ pauseMs: 10000 });
  assert.ok(early.score > 60);
  assert.ok(paused.score <= 60);
  assert.equal(paused.score, 58);
  assert.ok(reasonCodes(paused).includes('pause'));
});

test('非演示模式的停顿扣分更缓', () => {
  const demo = computeScore({ pauseMs: 10000 }, { demoMode: true });
  const regular = computeScore({ pauseMs: 10000 }, { demoMode: false });
  assert.ok(regular.score > demo.score);
});

test('未完成句提供独立、可解释的扣分', () => {
  const complete = computeScore({ draftLength: 24, unfinishedSentence: false });
  const unfinished = computeScore({ draftLength: 24, unfinishedSentence: true });
  assert.equal(complete.score - unfinished.score, 9);
  assert.ok(reasonCodes(unfinished).includes('unfinished'));
});

test('回读次数增加会进一步降低评分', () => {
  const once = computeScore({ rereadCount: 1 });
  const twice = computeScore({ rereadCount: 2 });
  assert.equal(once.score, 97);
  assert.equal(twice.score, 94);
  assert.ok(reasonCodes(twice).includes('reread'));
});

test('长回答后未续写被纳入评分和快照', () => {
  const result = computeScore({ longAnswerUncontinued: true });
  assert.equal(result.score, 86);
  assert.equal(result.featureSnapshot.longAnswerUncontinued, true);
  assert.ok(reasonCodes(result).includes('long-answer'));
});

test('退格、重写、指代和草稿长度规则均生效', () => {
  const result = computeScore({
    backspaceRate: 0.5,
    rewriteCount: 2,
    unresolvedReference: true,
    draftLength: 300
  });
  for (const code of ['backspace', 'rewrite', 'reference', 'draft-length']) {
    assert.ok(reasonCodes(result).includes(code), code);
  }
  assert.equal(result.score, 72);
});

test('分数限制在 0 到 100，输入特征不会被修改', () => {
  const features = {
    pauseMs: 60000,
    backspaceRate: 1,
    rewriteCount: 20,
    rereadCount: 20,
    unfinishedSentence: true,
    longAnswerUncontinued: true,
    unresolvedReference: true,
    draftLength: 10000
  };
  const before = JSON.stringify(features);
  const result = computeScore(features, { mode: 'high' });
  assert.equal(result.score, 0);
  assert.equal(JSON.stringify(features), before);
});

test('阈值采用小于等于判定，并支持灵敏度和关闭', () => {
  const now = 100000;
  assert.equal(shouldTrigger(60, now, null, { threshold: 60 }), true);
  assert.equal(shouldTrigger(61, now, null, { threshold: 60 }), false);
  assert.equal(shouldTrigger(50, now, null, { mode: 'off' }), false);
  assert.equal(shouldTrigger(50, now, null, { enabled: false }), false);
});

test('连续弹窗在冷却期内被阻止，边界后恢复', () => {
  const lastShownAt = 100000;
  assert.equal(isInCooldown(lastShownAt + 1000, lastShownAt, 90000), true);
  assert.equal(shouldTrigger(50, lastShownAt + 89999, lastShownAt), false);
  assert.equal(shouldTrigger(50, lastShownAt + 90000, lastShownAt), true);
  assert.equal(shouldTrigger(50, lastShownAt + 90000, lastShownAt, { cooldownMs: 0 }), true);
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
if (failures > 0) {
  process.exitCode = 1;
}
