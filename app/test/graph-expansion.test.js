'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const graphApi = require('../js/thought-graph.js');
const expansion = require('../js/graph-expansion.js');

function initialGraph() {
  return graphApi.createGraphFromBubble({ id: 'root', text: '城市步行交通的观察研究', kind: 'idea' }, {
    messages: ['城市步行交通的观察研究'],
  });
}

const candidates = [
  { text: '城市步行交通的安全观察指标', kind: 'question', style: 'concrete' },
  { text: '城市步行交通的通勤观察指标', kind: 'question', style: 'concrete' },
  { text: '音乐节奏对创作环境的启发', kind: 'idea', style: 'abstract' },
];

test('原界面扩展统一经过图相关排序、MMR 和数量控制', () => {
  const graph = initialGraph();
  const before = JSON.stringify(graph);
  const result = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 2, exploration: 0.35 });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((candidate) => Number.isFinite(candidate.graphRelevance)));
  assert.ok(result.candidates.every((candidate) => candidate.exploration === 0.35));
  assert.equal(JSON.stringify(graph), before);
});

test('多样性优先时不会因字面接近而连续选择同一路径', () => {
  const graph = initialGraph();
  const focused = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 2, exploration: 1 });
  const diverse = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 2, exploration: 0 });
  assert.notDeepEqual(focused.candidates.map((item) => item.text), diverse.candidates.map((item) => item.text));
  assert.ok(diverse.candidates.some((item) => item.text.includes('音乐节奏')));
});

test('已有和被拒绝路径在生成前被拦截，原话不会被修改', () => {
  let graph = initialGraph();
  const original = graph.nodes[0].text;
  const first = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 2, exploration: 1 });
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', first.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = graphApi.setCandidateStatus(added.graph, added.addedIds[0], 'rejected');
  const second = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 2, exploration: 1 });
  const previousTexts = new Set(graph.nodes.map((node) => node.text));
  assert.ok(second.candidates.every((candidate) => !previousTexts.has(candidate.text)));
  assert.ok(second.duplicates.length > 0);
  assert.equal(graph.nodes[0].text, original);
});

test('暂停扩展在图计算和服务调用之前返回空候选', () => {
  const result = expansion.select(null, null, candidates, { count: 0 });
  assert.deepEqual(result.candidates, []);
  assert.match(result.reason, /暂停/);
});


test('边界扩张总率限制候选预算，待确认占额度且拒绝后释放', () => {
  let graph = initialGraph();
  const prefs = preferencesWithBoundary(1);
  const first = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 3, preferences: prefs });
  assert.equal(first.candidates.length, 1);
  assert.equal(first.boundary.target, 1);
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', first.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = added.graph;
  assert.equal(expansion.remainingCapacity(graph, prefs), 0);
  const stopped = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 3, preferences: prefs });
  assert.deepEqual(stopped.candidates, []);
  assert.match(stopped.reason, /总率上限/);
  graph = graphApi.setCandidateStatus(graph, added.addedIds[0], 'rejected');
  assert.equal(expansion.remainingCapacity(graph, prefs), 1);
  const resumed = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 3, preferences: prefs });
  assert.equal(resumed.candidates.length, 1);
});

test('提高总率上限后允许继续，接受候选形成真实当前比例', () => {
  let graph = initialGraph();
  const first = expansion.select(graph, graph.rootId, candidates, { action: 'project', count: 1, preferences: preferencesWithBoundary(1) });
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', first.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = graphApi.setCandidateStatus(added.graph, added.addedIds[0], 'accepted');
  assert.equal(expansion.remainingCapacity(graph, preferencesWithBoundary(1)), 0);
  assert.equal(expansion.remainingCapacity(graph, preferencesWithBoundary(2)), 1);
  assert.equal(expansion.boundaryState(graph, preferencesWithBoundary(2)).rate, 1);
});

function preferencesWithBoundary(boundaryTarget) {
  return { boundaryTarget, count: 3 };
}
