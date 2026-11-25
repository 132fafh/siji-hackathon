'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const soap = require('../js/light-field-soap.js');
const natural = require('../js/light-field-natural.js');
const fs = require('node:fs');
const path = require('node:path');

test('聚簇布局可复现，非网格排列且气泡不重叠', () => {
  const bubbles = Array.from({ length: 12 }, (_, index) => ({ id: 'b' + index, radius: index === 0 ? 54 : 22 + index % 4, current: index === 0 }));
  const first = soap.clusteredLayout(bubbles, { seed: 37, groupCount: 3, width: 1400, height: 900 });
  assert.deepEqual(first, soap.clusteredLayout(bubbles, { seed: 37, groupCount: 3, width: 1400, height: 900 }));
  assert.equal(new Set(first.map((bubble) => bubble.group)).size, 3);
  const xs = new Set(first.map((bubble) => bubble.x.toFixed(1)));
  const ys = new Set(first.map((bubble) => bubble.y.toFixed(1)));
  assert.ok(xs.size > 8 && ys.size > 6);
  first.forEach((a, i) => first.slice(i + 1).forEach((b) => {
    const distance = Math.hypot((a.x - b.x) * 14, (a.y - b.y) * 9);
    assert.ok(distance > 0.5);
  }));
});

test('群组连接随距离减弱，拖出阈值后自然分开', () => {
  const bubbles = [
    { id: 'a', group: 0, x: 20, y: 20 },
    { id: 'b', group: 0, x: 25, y: 20 },
    { id: 'c', group: 1, x: 24, y: 20 },
  ];
  const near = soap.groupLinks(bubbles, 24);
  assert.equal(near.length, 1);
  assert.equal(near[0].a, 'a');
  const far = soap.groupLinks([bubbles[0], Object.assign({}, bubbles[1], { x: 70, y: 70 }), bubbles[2]], 24);
  assert.equal(far.length, 0);
});

test('薄膜颜色随类别、时间和收束变化但保持平滑', () => {
  const content = soap.filmColor('content', 2, 0.2);
  const later = soap.filmColor('content', 8, 0.2);
  const warm = soap.filmColor('content', 8, 1);
  const neutral = soap.filmColor('function', 8, 0.2);
  assert.notEqual(content.h, later.h);
  assert.ok(warm.h > later.h);
  assert.equal(neutral.s, 32);
});

test('肥皂泡分裂保持独立初速度、缓动与静止收尾', () => {
  const vectors = natural.burstVectors(11, 3);
  const first = natural.burstMotion(vectors[0], 0.2, false);
  const second = natural.burstMotion(vectors[1], 0.2, false);
  assert.notEqual(first.rotation, second.rotation);
  assert.ok(Math.hypot(first.x, first.y) > 0);
  const settled = natural.burstMotion(vectors[0], 1.3, false);
  assert.equal(settled.done, true);
  assert.equal(settled.rotation, 0);
});

test('保留 Aurora 算法的 MIT 版权与许可说明', () => {
  const license = fs.readFileSync(path.join(__dirname, '..', 'licenses', 'aurora-MIT.txt'), 'utf8');
  const shader = fs.readFileSync(path.join(__dirname, '..', 'js', 'light-field-renderer.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Joseph Edwards/);
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted/);
  assert.match(shader, /Copyright \(c\) 2026 Joseph Edwards/);
});
