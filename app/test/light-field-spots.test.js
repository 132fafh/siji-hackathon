'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spots = require('../js/light-field-spots.js');

test('光斑生成可复现，尺寸、透明度和呼吸速度符合安静范围', () => {
  const first = spots.createLightSpots(8, 43);
  assert.deepEqual(first, spots.createLightSpots(8, 43));
  assert.equal(first.length, 8);
  assert.ok(first.every((spot) => spot.radius >= 18 && spot.radius <= 50));
  assert.ok(first.every((spot) => spot.baseAlpha >= 0.04 && spot.baseAlpha <= 0.12));
  assert.ok(first.every((spot) => spot.breathSpeed >= 0.003 && spot.breathSpeed <= 0.011));
  assert.ok(new Set(first.map((spot) => spot.radius)).size > 4);
});

test('呼吸透明度连续且不同相位不会同步闪烁', () => {
  const first = spots.createLightSpots(2, 43);
  const a = spots.spotAlpha(first[0], 10);
  const b = spots.spotAlpha(first[0], 10.05);
  assert.ok(Math.abs(a - b) < 0.01);
  assert.notEqual(spots.spotAlpha(first[0], 10), spots.spotAlpha(first[1], 10));
  assert.ok(a <= first[0].baseAlpha);
});

test('光斑按秒慢速连续移动，边界从画面外平滑环绕', () => {
  const spot = spots.createLightSpots(1, 43)[0];
  const viewport = { width: 1000, height: 600 };
  const before = spots.spotPosition(spot, 0, viewport);
  const after = spots.spotPosition(spot, 0.1, viewport);
  assert.ok(Math.hypot((after.x - before.x) * 1000, (after.y - before.y) * 600) < 1);
  const crossing = spots.spotPosition(Object.assign({}, spot, { x: 1.1, vx: 10 }), 0.01, viewport);
  assert.ok(crossing.x >= -0.2 && crossing.x <= 1.2);
  assert.ok(crossing.x < 0);
});

test('坐标环绕连续且不会出现第二个亮斑', () => {
  assert.equal(spots.wrapCoordinate(-5, -10, 100), -5);
  assert.equal(spots.wrapCoordinate(105, -10, 100), -5);
  assert.equal(spots.wrapCoordinate(50, -10, 100), 50);
});

test('reduced-motion 固定光斑位置和透明度', () => {
  const list = spots.createLightSpots(5, 43);
  const viewport = { width: 1000, height: 600 };
  assert.deepEqual(spots.sampleSpots(list, 2, viewport, true), spots.sampleSpots(list, 80, viewport, true));
});
