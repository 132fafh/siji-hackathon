'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fluid = require('../js/light-field-fluid.js');

test('点涡速度满足公式方向并限制中心奇点', () => {
  const vortex = { x: 0, y: 0, gamma: Math.PI * 2, coreRadius: 0.5, maxSpeed: 10 };
  const right = fluid.vortexVelocity(1, 0, vortex);
  const top = fluid.vortexVelocity(0, 1, vortex);
  assert.ok(Math.abs(right.u) < 1e-10);
  assert.ok(Math.abs(right.v - 1) < 1e-10);
  assert.ok(Math.abs(top.u + 1) < 1e-10);
  assert.ok(Math.abs(top.v) < 1e-10);
  assert.deepEqual(fluid.vortexVelocity(0, 0, vortex), { u: 0, v: 0 });
  const near = fluid.vortexVelocity(0.0001, 0.0001, { x: 0, y: 0, gamma: 1e9 });
  assert.ok(Number.isFinite(near.u) && Number.isFinite(near.v));
  assert.ok(Math.hypot(near.u, near.v) <= 1.8);
});

test('双线性颜色采样插值正确且边界有限', () => {
  const field = new Float32Array([
    0, 0, 0, 1, 0, 0,
    0, 1, 0, 1, 1, 0,
  ]);
  const middle = fluid.bilinearColor(field, 2, 2, 0.5, 0.5);
  assert.ok(Math.abs(middle[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(middle[1] - 0.5) < 1e-6);
  assert.equal(middle[2], 0);
  assert.ok(fluid.bilinearColor(field, 2, 2, -100, 100).every(Number.isFinite));
});

test('RK2 半拉格朗日回溯保持均匀颜色并衰减出界颜色', () => {
  const width = 8;
  const height = 6;
  const field = new Float32Array(width * height * 3);
  for (let index = 0; index < field.length; index += 3) {
    field[index] = 0.2;
    field[index + 1] = 0.4;
    field[index + 2] = 0.6;
  }
  const center = fluid.advectionSample(field, width, height, 4, 3, [], 0.05);
  center.forEach((value, index) => assert.ok(Math.abs(value - [0.2, 0.4, 0.6][index]) < 1e-6));
  const edge = fluid.advectionSample(field, width, height, 0, 3, [], 0.05);
  assert.deepEqual(edge, [0, 0, 0]);
});

test('涡元生成随辐角和流速改变环量、色相与亮度', () => {
  const first = fluid.createVortex(10, 12, { angle: 0, speed: 0.2 });
  const opposite = fluid.createVortex(10, 12, { angle: Math.PI, speed: 0.2 });
  const faster = fluid.createVortex(10, 12, { angle: 0, speed: 2.4 });
  assert.ok(first.gamma > 0 && opposite.gamma < 0);
  assert.notEqual(first.hue, opposite.hue);
  assert.notEqual(first.hue, faster.hue);
  assert.ok(faster.lightness > first.lightness);
  assert.equal(first.x, 10);
  assert.equal(first.y, 12);
  [first, opposite, faster].forEach((vortex) => {
    assert.ok(Number.isFinite(vortex.gamma) && Number.isFinite(vortex.hue));
    assert.ok(vortex.hue >= 0 && vortex.hue < 360);
  });
});

test('涡元衰减连续且生命周期结束后移除', () => {
  const initial = fluid.createVortex(4, 5, { gamma: 20, life: 2, decay: 0.2 });
  const later = fluid.decayVortex(initial, 0.5);
  assert.ok(later.gamma < initial.gamma && later.gamma > 0);
  assert.ok(later.lightness < initial.lightness);
  assert.equal(later.alive, true);
  const expired = fluid.decayVortex(later, 2);
  assert.equal(expired.alive, false);
  assert.deepEqual(fluid.decayVortices([initial, later, expired], 0).length, 2);
});

test('点击颜色注入形成有限柔和平铺扰动', () => {
  const width = 20;
  const height = 14;
  const empty = new Float32Array(width * height * 3);
  const vortex = fluid.createVortex(10, 7, { angle: 1.2, speed: 1.1, hue: 315 });
  const injected = fluid.injectColor(empty, width, height, 10, 7, vortex, 0.72);
  const center = (7 * width + 10) * 3;
  const corner = 0;
  assert.ok(injected[center] > 0 && injected[center + 2] > 0);
  assert.ok(injected[corner] < injected[center] * 0.02);
  assert.notDeepEqual(injected, empty);
  const moved = fluid.advectColorField(injected, width, height, [vortex], 0.06);
  assert.notDeepEqual(moved, injected);
});

test('粗网格平流在强涡和大时间步下无 NaN、爆炸或颜色溢出', () => {
  const width = 20;
  const height = 12;
  let field = new Float32Array(width * height * 3);
  for (let index = 0; index < field.length; index++) field[index] = (index % 11) / 14;
  const vortices = [
    { x: 10, y: 6, gamma: 36, coreRadius: 2.2 },
    { x: 10.00001, y: 6, gamma: -36, coreRadius: 2.2 },
  ];
  const initialEnergy = field.reduce((sum, value) => sum + value, 0);
  for (let step = 0; step < 60; step++) {
    field = fluid.advectColorField(field, width, height, vortices, step === 0 ? 10 : 0.06);
    assert.ok(field.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  const finalEnergy = field.reduce((sum, value) => sum + value, 0);
  assert.ok(finalEnergy < initialEnergy);
});

test('拖动接口注入涡元，普通抬起不再单击生成', () => {
  const gradient = { addColorStop() {} };
  const context = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},
    drawImage() {},
    fillRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    getContext: (type) => type === '2d' ? context : null,
    addEventListener() {},
    removeEventListener() {},
  };
  const environment = {
    window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {}, createElement: () => canvas },
  };
  const motion = { matches: true, addEventListener() {}, removeEventListener() {} };
  const field = fluid.createFluidField(canvas, motion, environment);
  const before = Number(canvas.dataset.vortexCount || 0);
  field.dragNormalized(0.5, 0.5, 0.55);
  const afterDrag = Number(canvas.dataset.vortexCount || 0);
  assert.ok(afterDrag > before);
  field.pointerUp(400, 300, false, 'mouse');
  assert.equal(Number(canvas.dataset.vortexCount || 0), afterDrag);
  field.dispose();
});
