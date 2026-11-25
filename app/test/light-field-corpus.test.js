'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('../js/light-field-corpus.js');

test('词频概率只表示关键词在当前用户语料中的相对出现频次', () => {
  const rows = corpus.corpusFrequencies(['摄影 的 摄影', '的 新方向'], ['摄影', '的', '未知']);
  assert.deepEqual(rows.map((row) => row.count), [2, 2, 0]);
  assert.deepEqual(rows.map((row) => row.probability), [0.5, 0.5, 0]);
  assert.equal(rows.reduce((sum, row) => sum + row.probability, 0), 1);
});

test('频次尺寸映射单调且有界，避免极端大小', () => {
  const options = { minRadius: 16, maxRadius: 44 };
  assert.equal(corpus.sizeForProbability(-1, options), 16);
  assert.equal(corpus.sizeForProbability(2, options), 44);
  assert.ok(corpus.sizeForProbability(0.5, options) > corpus.sizeForProbability(0.1, options));
  assert.ok(corpus.sizeForProbability(0.5, options) < 44);
});

test('连续点击增大主气泡、缩小其他气泡并归档过小气泡', () => {
  const bubbles = [
    { id: 'main', x: 50, y: 50, radius: 30 },
    { id: 'small', x: 65, y: 50, radius: 12.2 },
    { id: 'other', x: 20, y: 50, radius: 20 },
  ];
  const result = corpus.clickResize(bubbles, 'main', { minRadius: 12, maxRadius: 48, width: 800, height: 600 });
  const main = result.bubbles.find((bubble) => bubble.id === 'main');
  const other = result.bubbles.find((bubble) => bubble.id === 'other');
  assert.ok(main.radius > 30 && main.radius <= 48);
  assert.ok(other.radius < 20 && other.radius >= 12);
  assert.equal(result.archived.length, 1);
  assert.equal(result.archived[0].id, 'small');
  assert.equal(result.archived[0].archivedReason, 'too-small');
  assert.ok(result.bubbles.every((bubble) => bubble.x >= 0 && bubble.x <= 100 && bubble.y >= 0 && bubble.y <= 100));
});

test('每个父气泡确定性地分裂为 2–3 个子气泡', () => {
  ['摄影', '的', '新方向', '微光'].forEach((word) => {
    const count = corpus.splitCount(word);
    assert.ok(count === 2 || count === 3);
    assert.equal(count, corpus.splitCount(word));
  });
});

test('分裂优先同一用户消息共现词，不足时使用明确来源的候选词', () => {
  const candidates = ['摄影', '云雾', '清晨', '徒步', '故事', '摄影'];
  const related = corpus.cooccurrenceCandidates('摄影', ['清晨的摄影有云雾', '另一条消息'], candidates);
  assert.deepEqual(related.map((item) => item.text), ['云雾', '清晨']);
  assert.ok(related.every((item) => item.source === 'cooccurrence' && item.relationLabel.includes('共现')));
  const split = corpus.splitCandidates('摄影', ['清晨的摄影有云雾'], candidates, 3, { exclude: ['清晨'] });
  assert.equal(split.length, 3);
  assert.equal(split[0].text, '云雾');
  assert.ok(split.slice(1).every((item) => item.source === 'candidate' && item.relationLabel.includes('没有')));
});

test('语料箱归档与恢复不修改原数组，恢复后仍可继续操作', () => {
  const original = [];
  const boxed = corpus.archiveBubble(original, { id: 'parent', text: '摄影', radius: 30 });
  assert.equal(original.length, 0);
  assert.equal(boxed.length, 1);
  assert.equal(boxed[0].archived, true);
  const restored = corpus.restoreFromBox(boxed, 'parent');
  assert.equal(restored.box.length, 0);
  assert.equal(restored.bubble.text, '摄影');
  assert.equal(restored.bubble.archived, false);
  assert.equal(corpus.restoreFromBox(boxed, 'missing').bubble, null);
});
