'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const graphApi = require('../js/thought-graph.js');
const demo = require('../js/demo-expansion.js');
const guard = require('../js/graph-expansion-guard.js');

function initialGraph() {
  const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
  const turn = fixture.turns.find((item) => item.id === source.sourceTurnId);
  return graphApi.createGraphFromBubble({ id: source.id, text: source.text, kind: 'idea' }, { messages: [turn.text] });
}

test('同一父节点反复扩展会前进到新候选，已存在内容不会重复添加', () => {
  let graph = initialGraph();
  const texts = new Set();
  for (let round = 0; round < 4; round++) {
    const result = demo.expand({ node: graph.nodes[0], action: 'project', count: 2, exploration: 1, existingCandidates: graph.nodes });
    const added = graphApi.addExpansion(graph, graph.rootId, 'project', result.candidates, { actualMode: 'demo', timestamp: 100 + round });
    added.addedIds.forEach((id) => {
      const text = added.graph.nodes.find((node) => node.id === id).text;
      assert.equal(texts.has(text), false, '不得出现重复文本：' + text);
      texts.add(text);
    });
    graph = added.graph;
  }
  assert.ok(texts.size >= 4);
});

test('候选池耗尽后明确提示已有路径，不硬造重复节点', () => {
  const graph = initialGraph();
  const sourceText = graph.nodes[0].text;
  const candidates = [{ text: '「' + sourceText + '」之后，哪一个结果最值得先验证？', kind: 'question' }];
  const first = graphApi.addExpansion(graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 100 });
  const second = graphApi.addExpansion(first.graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 101 });
  assert.equal(second.addedIds.length, 0);
  assert.equal(second.duplicates.length, 1);
  assert.match(second.reason, /没有重复添加/);
  assert.equal(second.graph.nodes.length, first.graph.nodes.length);
});

test('被拒绝的候选也不会以相同文字重新出现', () => {
  let graph = initialGraph();
  const candidates = [{ text: '一个需要拒绝的候选', kind: 'idea' }];
  const first = graphApi.addExpansion(graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 100 });
  graph = graphApi.setCandidateStatus(first.graph, first.addedIds[0], 'rejected');
  const second = graphApi.addExpansion(graph, graph.rootId, 'project', candidates, { actualMode: 'demo', timestamp: 101 });
  assert.equal(second.addedIds.length, 0);
  assert.equal(second.duplicates[0].existingId, first.addedIds[0]);
});

test('字面去重保护数字和否定，不把不同方案误判为同义', () => {
  assert.equal(guard.duplicateScore('检查全部四张牌', '检查全部四张牌'), 1);
  assert.equal(guard.duplicateScore('检查全部四张牌', '检查最后两张牌'), 0);
  assert.equal(guard.duplicateScore('不只看停顿', '只看停顿'), 0);
});

test('λ 改变实际扩展路径，而不只是改变关键词', () => {
  const graph = initialGraph();
  const focused = demo.expand({ node: graph.nodes[0], action: 'project', count: 3, exploration: 1 });
  const diverse = demo.expand({ node: graph.nodes[0], action: 'project', count: 3, exploration: 0 });
  assert.notDeepEqual(focused.candidates.map((item) => item.text), diverse.candidates.map((item) => item.text));
  assert.ok(focused.candidates.every((item) => item.exploration === 1));
  assert.ok(diverse.candidates.every((item) => item.exploration === 0));
});

test('扩展已有模板节点时提取核心引文，避免先写下嵌套先写下', () => {
  const graph = initialGraph();
  const first = demo.expand({ node: graph.nodes[0], action: 'decompose', count: 1 });
  const nested = demo.expand({ node: { text: first.candidates[0].text, kind: 'question' }, action: 'decompose', count: 1 });
  assert.doesNotMatch(nested.candidates[0].text, /先写下「先写下/);
});
