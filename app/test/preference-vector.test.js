'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const preferences = require('../js/preference-vector.js');
const demo = require('../js/demo-expansion.js');

const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');

test('默认偏好向量有七个显式维度，不包含人格标签或跨会话标识', () => {
  const value = preferences.createPreferences();
  assert.equal(preferences.vectorFor(value).length, 7);
  assert.ok(preferences.vectorFor(value).every((score) => score === 0.5));
  assert.equal(value.count, 2);
  assert.deepEqual(value.history, []);
  assert.equal(Object.hasOwn(value, 'personality'), false);
  assert.equal(Object.hasOwn(value, 'userId'), false);
});

test('明确的具体路径偏好会改变 DeliData 节点的候选排序', () => {
  const balanced = demo.expand({ node: { text: source.text, kind: 'idea' }, action: 'alternatives', count: 3 });
  const concrete = demo.expand({
    node: { text: source.text, kind: 'idea' },
    action: 'alternatives',
    count: 3,
    preferences: { style: 'concrete' },
  });
  assert.equal(balanced.candidates[0].style, 'abstract');
  assert.equal(concrete.candidates[0].style, 'concrete');
  assert.ok(concrete.candidates[0].preferenceScore > concrete.candidates[2].preferenceScore);
});

test('接受与拒绝只调整当前动作和风格权重，并保留最近反馈', () => {
  const initial = preferences.createPreferences();
  const candidate = { id: 'candidate-1', action: 'challenge', style: 'concrete' };
  const accepted = preferences.applyFeedback(initial, candidate, true, 100);
  assert.ok(accepted.weights.challenge > initial.weights.challenge);
  assert.ok(accepted.weights.concrete > initial.weights.concrete);
  assert.equal(accepted.history.length, 1);
  const rejected = preferences.applyFeedback(accepted, candidate, false, 200);
  assert.ok(rejected.weights.challenge < accepted.weights.challenge);
  assert.equal(rejected.history.length, 2);
  assert.equal(initial.weights.challenge, 0.5);
});

test('显式权重、候选数量和重置均可编辑且有界', () => {
  let value = preferences.createPreferences();
  value = preferences.updatePreference(value, 'trace', 2);
  value = preferences.updatePreference(value, 'count', 3);
  assert.equal(value.weights.trace, 0.95);
  assert.equal(value.count, 3);
  value = preferences.updatePreference(value, 'project', -1);
  assert.equal(value.weights.project, 0.05);
  const reset = preferences.resetPreferences();
  assert.ok(preferences.vectorFor(reset).every((score) => score === 0.5));
  assert.equal(reset.count, 2);
  assert.deepEqual(reset.history, []);
});

test('持久化输入经过清洗，非法历史和权重不会进入偏好向量', () => {
  const value = preferences.createPreferences({
    weights: { project: 'bad', trace: 100 },
    count: 99,
    style: 'fixed-personality',
    history: [{ action: 'unknown', accepted: true }, { action: 'project', candidateId: 'x', accepted: true, ts: 1 }],
  });
  assert.equal(value.weights.project, 0.5);
  assert.equal(value.weights.trace, 0.95);
  assert.equal(value.count, 2);
  assert.equal(value.style, 'balanced');
  assert.equal(value.history.length, 1);
});


test('边界扩张总率上限可编辑、持久化清洗并可重置', () => {
  const initial = preferences.createPreferences();
  assert.equal(initial.boundaryTarget, 5);
  const changed = preferences.updatePreference(initial, 'boundaryTarget', 2);
  assert.equal(changed.boundaryTarget, 2);
  assert.equal(initial.boundaryTarget, 5);
  assert.equal(preferences.createPreferences({ boundaryTarget: 99 }).boundaryTarget, 5);
  assert.equal(preferences.createPreferences({ boundaryTarget: 1 }).boundaryTarget, 1);
  assert.equal(preferences.resetPreferences().boundaryTarget, 5);
});
