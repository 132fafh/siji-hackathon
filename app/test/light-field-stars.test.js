'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const stars = require('../js/light-field-stars.js');

test('星形可复现且不同节点不是相同圆球', () => {
  const first = stars.starShape('摄影');
  const other = stars.starShape('云雾');
  assert.deepEqual(first, stars.starShape('摄影'));
  assert.notEqual(first.path, other.path);
  assert.match(first.path, /^M.* Z$/);
  assert.ok(first.coreScale > 0.7 && first.coreScale <= 1.25);
});

test('星点透明度连续，聚焦时完全清晰', () => {
  const before = stars.starOpacity('摄影', 4, false);
  const after = stars.starOpacity('摄影', 4.05, false);
  assert.ok(Math.abs(before - after) < 0.02);
  assert.equal(stars.starOpacity('摄影', 4, true), 1);
  assert.notEqual(stars.starOpacity('摄影', 4, false), stars.starOpacity('云雾', 4, false));
});

test('星落轨迹极慢、连续且同组一致', () => {
  const first = stars.starFallTrajectory(2, 10);
  const second = stars.starFallTrajectory(2, 10.1);
  assert.ok(Math.hypot(second.x - first.x, second.y - first.y) < 0.05);
  assert.deepEqual(first, stars.starFallTrajectory(2, 10));
  assert.notDeepEqual(first, stars.starFallTrajectory(3, 10));
});

test('多尺度星芒与慢速余晖可复现且连续', () => {
  const rays = stars.starRays('摄影', 12);
  assert.equal(rays.length, 12);
  assert.deepEqual(rays, stars.starRays('摄影', 12));
  assert.ok(new Set(rays.map((ray) => ray.opacity)).size > 4);
  const before = stars.meteorTrail('摄影', 5);
  const after = stars.meteorTrail('摄影', 5.1);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1);
  assert.ok(after.opacity >= 0 && after.opacity <= 0.16);
});

test('星座连线距离越远越弱，流光偏移连续', () => {
  const near = stars.starLinkStyle(4, 10);
  const far = stars.starLinkStyle(80, 10);
  assert.ok(near.opacity > far.opacity);
  assert.equal(far.opacity, 0);
  assert.ok(stars.starLinkStyle(4, 10.1).dashOffset < near.dashOffset);
});

test('星芒分裂保持独立方向、缓动与静止收尾', () => {
  const birth = { vx: 20, vy: -10, phase: 1.2 };
  const early = stars.starburstMotion(birth, 0.2, false);
  const late = stars.starburstMotion(birth, 1.3, false);
  assert.ok(Math.hypot(early.x, early.y) > 0);
  assert.notEqual(early.rotation, 0);
  assert.equal(late.done, true);
  assert.equal(late.rotation, 0);
  assert.deepEqual(stars.starburstMotion(birth, 0.2, true), { x: 20, y: -10, rotation: 0, opacity: 1, scale: 1, done: true });
});
