'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');

global.window = global;
require('../js/public-delidata.js');
const { run } = require('../js/growth-validation-runner.js');

test('DeliData 数据验证序列的接受、探索和暂停指标可复现', async () => {
  const result = await run({ data: fixture });
  assert.equal(result.caseId, fixture.caseId);
  assert.equal(result.steps.length, 6);
  const [baseline, first, second, exhausted, accepted, paused] = result.steps;
  assert.equal(baseline.metrics.boundaryExpansionRate, 0);
  assert.equal(first.metrics.acceptedExpansions, 2);
  assert.equal(first.metrics.acceptanceRate, 2 / 3);
  assert.equal(first.metrics.duplicateRate, 0);
  assert.equal(second.metrics.acceptedExpansions, 2);
  assert.equal(second.metrics.duplicateRate, 1 / 3);
  assert.equal(exhausted.metrics.duplicateRate, 0.6);
  assert.match(exhausted.detail.reason, /不再重复生成/);
  assert.equal(accepted.metrics.acceptedExpansions, 5);
  assert.equal(accepted.metrics.boundaryExpansionRate, 5);
  assert.equal(accepted.metrics.acceptanceRate, 5 / 6);
  assert.equal(accepted.metrics.generated, 9);
  assert.equal(accepted.metrics.skippedDuplicates, 9);
  assert.equal(paused.metrics.generated, accepted.metrics.generated);
  assert.equal(paused.metrics.acceptedExpansions, accepted.metrics.acceptedExpansions);
  assert.match(paused.detail.reason, /B=0/);
});

test('验证步骤包含原始图、指标、来源和可导出证据', async () => {
  const result = await run({ data: fixture });
  assert.equal(result.source.url, fixture.source.url);
  result.steps.forEach((step) => {
    assert.ok(step.graph.nodes.length > 0);
    assert.ok(step.metrics);
    assert.ok(step.label);
    assert.equal(step.metrics.model, 'project-defined-boundary-growth-v1');
  });
  assert.doesNotThrow(() => JSON.stringify(result));
});
