'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const graph = require('../js/thought-graph.js');
const demo = require('../js/demo-expansion.js');

const turnById = new Map(fixture.turns.map((turn) => [turn.id, turn]));
const nodeById = new Map(fixture.expectedStarfall.starNodes.map((node) => [node.id, node]));

test('DeliData 节点按思维功能分类，保留疑问、前提和结论差异', () => {
  const expectedKinds = {
    'solution-all-four': 'idea',
    'solution-last-two': 'idea',
    'solution-third-card': 'idea',
    'question-why-a': 'question',
    'reason-third-vowel': 'evidence',
    'reason-back-unknown': 'question',
    'reason-flip-tests-rule': 'premise',
    'reason-other-cards': 'evidence',
    'solution-final-a': 'conclusion',
  };
  Object.entries(expectedKinds).forEach(([id, kind]) => {
    const item = nodeById.get(id);
    const turn = turnById.get(item.sourceTurnId);
    assert.equal(graph.classifyThought(item.text, { role: turn.role, final: id === 'solution-final-a' }), kind, id);
  });
});

test('同一候选星团中的三个方案始终保持独立来源和数字范围', () => {
  const cluster = fixture.expectedStarfall.clusters.find((item) => item.id === 'candidate-solutions');
  const nodes = cluster.nodeIds.map((id) => nodeById.get(id));
  assert.equal(new Set(nodes.map((node) => node.text)).size, 3);
  assert.deepEqual(nodes.map((node) => graph.classifyThought(node.text, { role: 'Solution' })), ['idea', 'idea', 'idea']);
  assert.match(nodes[0].text, /all four/);
  assert.match(nodes[1].text, /last 2/);
  assert.match(nodes[2].text, /3rd/);
});

test('星点导图保留完整原话，创建关系不会修改原始会话', () => {
  const item = nodeById.get('solution-third-card');
  const source = turnById.get(item.sourceTurnId).text;
  const session = { id: 'public-case', original: { text: source, ts: 1 } };
  const snapshot = JSON.stringify(session.original);
  const map = graph.createGraphFromBubble({ id: item.id, text: item.text, kind: 'idea' }, {
    session,
    messages: fixture.turns.map((turn) => ({ id: turn.id, text: turn.text })),
    bubbles: [{ id: item.id, text: item.text }],
  });
  assert.equal(map.nodes[0].sourceQuote, source);
  assert.equal(map.nodes[1].fullText, source);
  assert.equal(map.edges[0].type, 'source');
  assert.equal(JSON.stringify(session.original), snapshot);
});

test('AI 扩展默认待确认，接受、拒绝和编辑均不改变原话或 AI 来源', () => {
  const item = nodeById.get('solution-third-card');
  const source = turnById.get(item.sourceTurnId).text;
  let map = graph.createGraphFromBubble({ id: item.id, text: item.text, kind: 'idea' }, { messages: [source] });
  const result = demo.expand({ node: map.nodes[0], action: 'alternatives', count: 2 });
  const added = graph.addExpansion(map, item.id, 'alternatives', result.candidates, { actualMode: 'demo', timestamp: 100 });
  map = added.graph;
  assert.equal(added.addedIds.length, 2);
  const id = added.addedIds[0];
  let node = map.nodes.find((item) => item.id === id);
  assert.equal(node.status, 'candidate');
  assert.equal(node.sourceOrigin, 'ai');
  assert.equal(node.demo, true);
  map = graph.editGraphNode(map, id, '用户修改后的候选路径');
  map = graph.setCandidateStatus(map, id, 'accepted');
  node = map.nodes.find((item) => item.id === id);
  assert.equal(node.status, 'accepted');
  assert.equal(node.sourceOrigin, 'ai');
  assert.equal(node.labelOrigin, 'user_edit');
  map = graph.setCandidateStatus(map, id, 'rejected');
  assert.equal(graph.layoutGraph(map).nodes.some((item) => item.id === id), false);
  assert.equal(graph.layoutGraph(map, { includeRejected: true }).nodes.some((item) => item.id === id), true);
  assert.equal(map.nodes[0].sourceQuote, source);
});

test('片段默认不自动扩展，依据节点不能随意向后编造结论', () => {
  assert.deepEqual(graph.allowedActions('fragment'), []);
  assert.deepEqual(graph.allowedActions('evidence').map((item) => item.id), ['trace', 'challenge']);
  const result = demo.expand({ node: { text: '有个还说不出来的东西', kind: 'fragment' }, action: 'project' });
  assert.equal(result.candidates.length, 0);
  assert.match(result.reason, /默认不由 AI 补全/);
});

test('扩展节点按层级布局，同层节点不会使用相同坐标', () => {
  const item = nodeById.get('solution-third-card');
  let map = graph.createGraphFromBubble({ id: item.id, text: item.text, kind: 'idea' }, { messages: [turnById.get(item.sourceTurnId).text] });
  const result = demo.expand({ node: map.nodes[0], action: 'decompose', count: 3 });
  map = graph.addExpansion(map, item.id, 'decompose', result.candidates, { actualMode: 'demo', timestamp: 100 }).graph;
  const layout = graph.layoutGraph(map);
  const positions = Object.values(layout.positions);
  assert.equal(new Set(positions.map((position) => position.x + ',' + position.y)).size, positions.length);
  assert.ok(Math.max(...layout.nodes.map((node) => node.depth)) >= 2);
});
