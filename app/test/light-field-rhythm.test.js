'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/light-field-core.js');
const renderer = require('../js/light-field-renderer.js');

test('环境节奏包含安静、呼吸、回应和释放，安静段保持低强度', () => {
  const quiet = renderer.sceneEnvelope(2, 0, 0);
  const still = renderer.sceneEnvelope(4, 0, 0);
  const breathe = renderer.sceneEnvelope(11, 0, 0);
  const respond = renderer.sceneEnvelope(11, 0.8, 0);
  const release = renderer.sceneEnvelope(11, 0.8, 0.8);
  assert.equal(quiet.stage, 'quiet');
  assert.equal(quiet.intensity, still.intensity);
  assert.equal(breathe.stage, 'breathe');
  assert.ok(breathe.intensity > quiet.intensity);
  assert.equal(respond.stage, 'respond');
  assert.ok(respond.intensity > breathe.intensity);
  assert.equal(release.stage, 'release');
  assert.ok(release.intensity > respond.intensity);
});

test('spring/阻尼向目标运动并最终收敛，长时间步长不会发散', () => {
  let state = { value: 0, velocity: 0 };
  const first = renderer.springStep(state.value, 1, state.velocity, 1 / 60, 58, 15);
  assert.ok(first.value > 0 && first.value < 1);
  assert.ok(first.velocity > 0);
  state = first;
  for (let i = 0; i < 300; i++) state = renderer.springStep(state.value, 1, state.velocity, 1 / 60, 58, 15);
  assert.ok(Math.abs(state.value - 1) < 0.01);
  assert.ok(Math.abs(state.velocity) < 0.05);
  const bounded = renderer.springStep(0, 1, 0, 10, 58, 15);
  assert.ok(Number.isFinite(bounded.value) && bounded.value < 0.2);
});

test('文字色调根据背景对比度选择，黑白极端背景方向正确', () => {
  const darkText = { r: 18, g: 29, b: 38 };
  const lightText = { r: 240, g: 247, b: 248 };
  assert.equal(core.textToneForBackground({ r: 255, g: 255, b: 255 }), 'dark');
  assert.equal(core.textToneForBackground({ r: 0, g: 0, b: 0 }), 'light');
  [{ r: 190, g: 140, b: 80 }, { r: 65, g: 140, b: 125 }, { r: 90, g: 105, b: 130 }].forEach((color) => {
    const tone = core.textToneForBackground(color);
    const selected = tone === 'dark' ? darkText : lightText;
    const other = tone === 'dark' ? lightText : darkText;
    assert.ok(core.contrastRatio(color, selected) >= core.contrastRatio(color, other));
  });
});

test('戳破转场依次为聚集、消散、到达，reduced-motion 直接回落', () => {
  assert.equal(core.getTransitionPhase(100, false), 'gather');
  assert.equal(core.getTransitionPhase(700, false), 'burst');
  assert.equal(core.getTransitionPhase(1100, false), 'arrive');
  assert.equal(core.getTransitionPhase(1600, false), 'idle');
  assert.equal(core.getTransitionPhase(700, true), 'idle');
});
