'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const drag = require('../js/light-field-drag.js');

test('8px 阈值区分点击与拖拽', () => {
  assert.equal(drag.shouldStartDrag(6, 5), false);
  assert.equal(drag.shouldStartDrag(8, 0), true);
  assert.equal(drag.shouldStartDrag(6, 6), true);
});

test('拖拽坐标跟随指针且不会移出屏幕', () => {
  const bubble = { x: 50, y: 50, radius: 30 };
  const moved = drag.dragBubbleTo(bubble, 500, 300, { width: 1000, height: 600 });
  assert.equal(moved.x, 50);
  assert.equal(moved.y, 50);
  const clamped = drag.dragBubbleTo(bubble, -500, 900, { width: 1000, height: 600 });
  assert.ok(clamped.x >= 3.8 && clamped.y <= 93.66666666666667);
  assert.ok(clamped.x === 3.8);
});

test('松手速度受限且 reduced-motion 不产生惯性', () => {
  const velocity = drag.releaseVelocity(1000, 0, false);
  assert.ok(velocity.x > 0 && velocity.x <= 60);
  assert.deepEqual(drag.releaseVelocity(1000, 500, true), { x: 0, y: 0 });
});

test('惯性方向与最近速度一致并连续衰减、受边界约束', () => {
  const bubble = { x: 50, y: 50, radius: 20 };
  const velocity = { x: 50, y: 0 };
  const step = drag.inertiaStep(bubble, velocity, 0.05, { width: 1000, height: 600 });
  assert.ok(step.bubble.x > bubble.x);
  assert.ok(step.velocity.x > 0 && step.velocity.x < velocity.x);
  const edge = drag.inertiaStep({ x: 99, y: 50, radius: 30 }, { x: 50, y: 0 }, 0.05, { width: 1000, height: 600 });
  assert.equal(edge.velocity.x, 0);
  assert.ok(edge.bubble.x <= 96.2);
});

test('HTML 中所有本地 JS/CSS 都使用统一版本号防止旧缓存', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const assets = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(?:\?v=([^"]+))?"/g));
  assert.ok(assets.length >= 10);
  const version = assets[0][2];
  assert.ok(version, '首个本地资源缺少版本号');
  assets.forEach((asset) => assert.equal(asset[2], version, asset[1] + ' 缺少统一版本号'));
});
