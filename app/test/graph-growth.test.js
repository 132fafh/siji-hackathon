'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const graphApi = require('../js/thought-graph.js');
const growth = require('../js/graph-growth.js');
const preferences = require('../js/preference-vector.js');
const demo = require('../js/demo-expansion.js');

function publicGraph() {
  const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
  const turn = fixture.turns.find((item) => item.id === source.sourceTurnId);
  return graphApi.createGraphFromBubble({ id: source.id, text: source.text, kind: 'idea' }, { messages: [turn.text] });
}

test('初始边界为一个根节点，接受与拒绝比例不会混入待确认候选', () => {
  let graph = publicGraph();
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', [
    { text: '一个后续观察指标', kind: 'question' },
    { text: '一条不同验证路径', kind: 'direction' },
  ], { actualMode: 'demo', timestamp: 100 });
  graph = graphApi.setCandidateStatus(added.graph, added.addedIds[0], 'accepted');
  graph = graphApi.setCandidateStatus(graph, added.addedIds[1], 'rejected');
  const metrics = growth.computeGrowth(graph, { amount: 2 });
  assert.equal(metrics.baselineBoundary, 1);
  assert.equal(metrics.currentBoundary, 1);
  assert.equal(metrics.acceptedExpansions, 1);
  assert.equal(metrics.boundaryExpansionRate, 1);
  assert.equal(metrics.acceptanceRate, 0.5);
  assert.equal(metrics.pending, 0);
  assert.equal(metrics.generated, 2);
  assert.equal(metrics.added, 2);
  assert.equal(metrics.kindEntropy, 0);
});

test('重复拦截率使用真实生成与跳过数量', () => {
  let graph = publicGraph();
  const candidates = [{ text: '一个独立的后续观察指标', kind: 'idea' }];
  const first = graphApi.addExpansion(graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 100 });
  const second = graphApi.addExpansion(first.graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 101 });
  const metrics = growth.computeGrowth(second.graph);
  assert.equal(metrics.generated, 2);
  assert.equal(metrics.added, 1);
  assert.equal(metrics.skippedDuplicates, 1);
  assert.equal(metrics.duplicateRate, 1 / 3);
});

test('类型熵只在边界存在多种节点类型时大于零', () => {
  let graph = publicGraph();
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', [
    { text: '一个后续观察指标', kind: 'question' },
    { text: '一条不同验证路径', kind: 'direction' },
  ], { actualMode: 'demo', timestamp: 100 });
  graph = added.graph;
  assert.ok(growth.kindEntropy(growth.frontierNodes(graph)) > 0);
  assert.ok(growth.kindEntropy(growth.frontierNodes(graph)) <= 1);
});

test('B=0 是有效的暂停设置，不会生成候选', () => {
  const prefs = preferences.updatePreference(preferences.createPreferences(), 'count', 0);
  assert.equal(prefs.count, 0);
  const result = demo.expand({ node: { text: 'include the 3rd card', kind: 'idea' }, action: 'project', count: 0 });
  assert.equal(result.candidates.length, 0);
  assert.match(result.reason, /B=0/);
});
