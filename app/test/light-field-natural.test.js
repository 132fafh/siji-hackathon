'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const natural = require('../js/light-field-natural.js');
const core = require('../js/light-field-core.js');

test('自然配色的文字与背景对比清晰，深色文字适用于亮色环境', () => {
  ['ivory', 'mistCyan', 'lilac', 'sage', 'apricot'].forEach((name) => {
    const hex = natural.NATURAL_PALETTE[name];
    const color = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    const ink = { r: 36, g: 53, b: 47 };
    assert.equal(core.textToneForBackground(color), 'dark');
    assert.ok(core.contrastRatio(color, ink) >= 4.5);
  });
});

test('长按先形成裂纹，reduced-motion 不播放裂纹过程', () => {
  assert.equal(natural.crackProgress(0, false), 0);
  assert.equal(natural.crackProgress(325, false), 0.5);
  assert.equal(natural.crackProgress(650, false), 1);
  assert.equal(natural.crackProgress(325, true), 0);
  assert.equal(natural.crackProgress(650, true), 1);
});

test('子气泡初速度可复现且方向、速度各自独立', () => {
  const first = natural.burstVectors(7, 3);
  assert.deepEqual(first, natural.burstVectors(7, 3));
  assert.equal(first.length, 3);
  assert.notEqual(first[0].vx, first[1].vx);
  assert.notEqual(first[0].phase, first[1].phase);
  assert.equal(natural.burstVectors(7, 2).length, 2);
});

test('子气泡连续向外缓动并停止摇摆，reduced-motion 直接到稳定状态', () => {
  const birth = natural.burstVectors(7, 2)[0];
  const early = natural.burstMotion(birth, 0.2, false);
  const later = natural.burstMotion(birth, 0.8, false);
  assert.ok(Math.hypot(later.x - early.x, later.y - early.y) > 0);
  assert.ok(early.opacity > 0 && early.opacity < 1);
  assert.ok(later.scale > early.scale);
  const done = natural.burstMotion(birth, 1.3, false);
  assert.equal(done.done, true);
  assert.equal(done.rotation, 0);
  assert.deepEqual(natural.burstMotion(birth, 0.2, true), { x: birth.vx, y: birth.vy, rotation: 0, opacity: 1, scale: 1, done: true });
});
