'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('../js/light-field-corpus.js');
const core = require('../js/light-field-core.js');

test('coherenceScore 使用可解释启发式，同消息连接提高收束度', () => {
  const context = {
    messages: ['摄影 云雾 清晨', '摄影 云雾 清晨', '摄影 云雾 清晨'],
    candidates: ['摄影', '云雾', '清晨'],
    previousKeyword: '摄影',
  };
  const high = corpus.coherenceDetails('摄影', context);
  const low = corpus.coherenceScore('摄影', { messages: ['完全无关的内容'], candidates: ['摄影', '云雾', '清晨'] });
  assert.ok(high.score > 0.65);
  assert.ok(low < 0.2);
  assert.ok(high.cooccurrence > 0 && high.graphConnection > 0 && high.topicContinuity > 0);
  assert.ok(high.score >= 0 && high.score <= 1);
});

test('收束明暗映射随分数提高亮度，高收束转向暖色象牙调', () => {
  const base = { r: 62, g: 120, b: 132 };
  const low = corpus.coherenceColor(base, 0);
  const middle = corpus.coherenceColor(base, 0.5);
  const high = corpus.coherenceColor(base, 1);
  assert.ok(core.relativeLuminance(middle) > core.relativeLuminance(low));
  assert.ok(core.relativeLuminance(high) > core.relativeLuminance(middle));
  assert.ok(high.r > 235 && high.g > 225 && high.b > 200);
});

test('空间邻近只平滑调整启发式显示收束度且保持 0–1', () => {
  const near = corpus.spatialCoherence(0.4, 0);
  const far = corpus.spatialCoherence(0.4, 200);
  assert.ok(near > far);
  assert.ok(near <= 1 && far >= 0);
  assert.ok(corpus.coherenceColor({ r: 62, g: 120, b: 132 }, 0).r < 62);
});

test('桌面基础与中央尺寸大于移动端且半径有界', () => {
  const desktop = corpus.responsiveSizeConfig(1440);
  const tablet = corpus.responsiveSizeConfig(900);
  const mobile = corpus.responsiveSizeConfig(390);
  assert.ok(desktop.minRadius > tablet.minRadius && tablet.minRadius > mobile.minRadius);
  assert.ok(desktop.currentMin >= 40 && desktop.currentMax <= 55);
  assert.ok(mobile.currentMin >= 50 && mobile.currentMax <= 70);
  assert.ok(desktop.maxRadius <= desktop.clickMaxRadius);
  assert.equal(corpus.sizeForProbability(2, desktop), desktop.maxRadius);
});

test('每泡运动可复现且连续，不同气泡拥有不同相位', () => {
  const first = { id: 'a', category: 'content' };
  const second = { id: 'b', category: 'content' };
  assert.deepEqual(corpus.motionForBubble(first, 10, false), corpus.motionForBubble(first, 10, false));
  assert.notDeepEqual(corpus.motionForBubble(first, 10, false), corpus.motionForBubble(second, 10, false));
  const before = corpus.motionForBubble(first, 10, false);
  const after = corpus.motionForBubble(first, 10.1, false);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.1);
});

test('相似类别共享流动分量，reduced-motion 完全停止漂移', () => {
  const sharedA = corpus.motionForBubble({ id: 'a', category: 'content' }, 8, false);
  const sharedB = corpus.motionForBubble({ id: 'b', category: 'content' }, 8, false);
  const other = corpus.motionForBubble({ id: 'c', category: 'function' }, 8, false);
  assert.equal(sharedA.groupX, sharedB.groupX);
  assert.equal(sharedA.groupY, sharedB.groupY);
  assert.notEqual(sharedA.groupX, other.groupX);
  assert.deepEqual(corpus.motionForBubble({ id: 'a', category: 'content' }, 8, true), { x: 0, y: 0, groupX: 0, groupY: 0 });
});
