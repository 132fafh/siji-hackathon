'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/light-field-core.js');

test('关键词去空白并按原顺序去重，英文忽略大小写', () => {
  assert.deepEqual(core.dedupeKeywords([' 光影 ', '光影', 'LIGHT', 'light', '', null, '呼吸']), ['光影', 'LIGHT', '呼吸']);
});

test('关键词轮换支持正数、负数与越界偏移', () => {
  assert.deepEqual(core.rotateKeywords(['甲', '乙', '丙'], 1), ['乙', '丙', '甲']);
  assert.deepEqual(core.rotateKeywords(['甲', '乙', '丙'], -1), ['丙', '甲', '乙']);
  assert.deepEqual(core.rotateKeywords(['甲', '乙', '丙'], 7), ['乙', '丙', '甲']);
  assert.deepEqual(core.rotateKeywords([], 2), []);
});

test('轮换取词不会立即重复刚戳破的文本', () => {
  assert.deepEqual(core.nextKeyword(['甲', '乙'], 0, '甲'), { text: '乙', cursor: 0 });
});

test('单个候选词会补充演示词，仍能避免立即重复', () => {
  const pool = core.keywordPool(['甲']);
  const next = core.nextKeyword(pool, 0, '甲');
  assert.equal(pool.length, 2);
  assert.notEqual(next.text, '甲');
});

test('关键词按虚词、疑问方向和内容词分类', () => {
  ['的', '了', '和', '我', '或'].forEach((word) => assert.equal(core.classifyKeyword(word), 'function'));
  ['为什么', '下一步', '新方向', '可能性'].forEach((word) => assert.equal(core.classifyKeyword(word), 'direction'));
  ['摄影集', '好奇心', '微光'].forEach((word) => assert.equal(core.classifyKeyword(word), 'content'));
});

test('bubbleColor 区分类型、随时间流转并响应局部触点', () => {
  const functionColor = core.bubbleColor(0.3, 0.4, 2, 'function');
  const contentColor = core.bubbleColor(0.3, 0.4, 2, 'content');
  const directionColor = core.bubbleColor(0.3, 0.4, 2, 'direction');
  assert.notDeepEqual(functionColor, contentColor);
  assert.notDeepEqual(contentColor, directionColor);
  const functionRange = Math.max(...Object.values(functionColor)) - Math.min(...Object.values(functionColor));
  const contentRange = Math.max(...Object.values(contentColor)) - Math.min(...Object.values(contentColor));
  assert.ok(functionRange < 45, '虚词应保持低饱和蓝灰');
  assert.ok(contentRange > 40, '内容词应有更明确的青绿蓝紫差异');
  assert.notDeepEqual(contentColor, core.bubbleColor(0.3, 0.4, 11, 'content'));
  const touched = core.bubbleColor(0.3, 0.4, 2, 'content', { x: 0.3, y: 0.4, energy: 1 });
  assert.ok(touched.r >= contentColor.r && touched.g >= contentColor.g && touched.b >= contentColor.b);
});

test('无关键词时使用演示词回退', () => {
  const bubbles = core.createInitialBubbles([], { width: 1024 });
  assert.equal(bubbles.length, 8);
  assert.ok(bubbles.every((bubble) => core.DEFAULT_KEYWORDS.includes(bubble.text)));
  assert.ok(core.keywordPool([]).length > 1);
});

test('桌面与移动端保留一个较大的当前想法气泡', () => {
  const desktop = core.createInitialBubbles(['甲', '乙', '丙'], { width: 1200 });
  const mobile = core.createInitialBubbles(['甲', '乙', '丙'], { width: 390 });
  assert.equal(desktop.length, 8);
  assert.equal(mobile.length, 5);
  assert.equal(desktop.filter((bubble) => bubble.current).length, 1);
  assert.equal(mobile.filter((bubble) => bubble.current).length, 1);
  assert.ok(desktop[0].size > Math.max(...desktop.slice(1).map((bubble) => bubble.size)));
  assert.ok(mobile[0].size > Math.max(...mobile.slice(1).map((bubble) => bubble.size)));
  assert.ok(desktop.concat(mobile).every((bubble) => bubble.x > 0 && bubble.x < 100 && bubble.y > 0 && bubble.y < 100));
});

test('reducedMotion 关闭漂移与粒子并保留即时操作反馈', () => {
  const normal = core.getMotionOptions(false);
  const reduced = core.getMotionOptions(true);
  assert.equal(normal.drift, true);
  assert.ok(normal.particleCount > 0);
  assert.equal(reduced.reducedMotion, true);
  assert.equal(reduced.drift, false);
  assert.equal(reduced.particleCount, 0);
  assert.equal(reduced.burstDuration, 0);
  assert.equal(reduced.longPressMs, 650);
});
