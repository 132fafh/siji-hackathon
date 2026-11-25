'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const life = require('../js/light-field-life.js');

test('微光生成可复现，数量受限且周期与相位独立', () => {
  const first = life.createMotes(5, 29);
  const second = life.createMotes(5, 29);
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.ok(new Set(first.map((mote) => mote.period)).size > 1);
  assert.ok(new Set(first.map((mote) => mote.phaseX)).size === first.length);
  assert.equal(life.createMotes(99, 29).length, 6);
});

test('生命周期经历出生、呼吸、衰减和再生且边界不闪烁', () => {
  const mote = life.createMotes(1, 29)[0];
  const start = -mote.phase;
  assert.ok(life.lifecycleAlpha(mote, start) < 0.001);
  assert.ok(life.lifecycleAlpha(mote, start + mote.period * 0.5) > 0.2);
  assert.ok(life.lifecycleAlpha(mote, start + mote.period * 0.99) < 0.01);
  assert.ok(life.lifecycleAlpha(mote, start + mote.period) < 0.001);
  const before = life.lifecycleAlpha(mote, start + mote.period - 0.001);
  const after = life.lifecycleAlpha(mote, start + mote.period + 0.001);
  assert.ok(Math.abs(before - after) < 0.001);
});

test('运动轨迹连续可复现，再生时位置不跳变', () => {
  const mote = life.createMotes(1, 29)[0];
  assert.deepEqual(life.motePosition(mote, 8), life.motePosition(mote, 8));
  const before = life.motePosition(mote, 10);
  const after = life.motePosition(mote, 10.05);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.01);
  const start = -mote.phase;
  const left = life.motePosition(mote, start + mote.period - 0.01);
  const right = life.motePosition(mote, start + mote.period + 0.01);
  assert.ok(Math.hypot(right.x - left.x, right.y - left.y) < 0.01);
});

test('连丝只在阈值内出现并随距离和生命周期自然消散', () => {
  const near = life.linkStrength({ x: 0.2, y: 0.2, alpha: 0.8 }, { x: 0.25, y: 0.2, alpha: 0.6 }, 0.22);
  const far = life.linkStrength({ x: 0.2, y: 0.2, alpha: 0.8 }, { x: 0.5, y: 0.2, alpha: 0.6 }, 0.22);
  assert.ok(near > 0 && near <= 0.6);
  assert.equal(far, 0);
  assert.equal(life.linkStrength({ x: 0.2, y: 0.2, alpha: 0 }, { x: 0.2, y: 0.2, alpha: 1 }), 0);
});

test('reduced-motion 固定所有微光并忽略触点唤醒', () => {
  const motes = life.createMotes(5, 29);
  const first = life.sampleMotes(motes, 4, { x: 0.5, y: 0.5, energy: 1 }, true);
  const second = life.sampleMotes(motes, 40, { x: 0.5, y: 0.5, energy: 1, afterglow: 1 }, true);
  assert.deepEqual(first, second);
  assert.ok(first.every((mote) => mote.alpha >= 0 && mote.alpha <= 1));
});
