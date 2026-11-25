'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'thought-map-view.js'), 'utf8');

test('导图默认只有网络，不渲染常驻栏、操作条或参量条', () => {
  ['thought-map-header', 'thought-inspector', 'thought-map-tools', 'thought-path-ribbon', 'thought-focus-control', 'data-keywords'].forEach((value) => {
    assert.equal(source.includes(value), false, value);
  });
  assert.match(source, /class="thought-map-viewport"/);
  assert.match(source, /class="thought-map-close"/);
});

test('节点操作归入右键、长按和键盘菜单', () => {
  ['source', 'preferences', 'accept', 'reject', 'edit', 'restore'].forEach((command) => {
    assert.match(source, new RegExp('data-menu-command="' + command + '"'));
  });
  assert.match(source, /longPressTimer/);
  assert.match(source, /}, 650\)/);
  assert.match(source, /event\.key === 'F10' && event\.shiftKey/);
});


test('数据验证和算法指标从原界面隐藏，扩展直接调用内部图算法', () => {
  assert.doesNotMatch(source, /thought-growth-metrics|thought-model-note|边界拓展率|重复拦截率/);
  assert.match(source, /SJ\.graphExpansion\.select/);
  assert.match(source, /enteringIds: addition\.addedIds/);
  assert.match(source, /count: 3/);
});


test('扩展偏好提供总率上限，达到额度时在服务调用前停止', () => {
  assert.match(source, /data-pref-boundary/);
  assert.match(source, /boundaryTarget/);
  assert.match(source, /remainingCapacity\(graph, preferences\)/);
  assert.match(source, /count: Math\.min\(3, capacity\)/);
  assert.doesNotMatch(source, /thought-preference-vector/);
});
