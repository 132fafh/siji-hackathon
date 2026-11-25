'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const graphApi = require('../js/thought-graph.js');
const organic = require('../js/organic-layout.js');
const demo = require('../js/demo-expansion.js');

function publicGraph() {
  const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
  const turn = fixture.turns.find((item) => item.id === source.sourceTurnId);
  const bubbles = fixture.expectedStarfall.clusters[0].nodeIds.map((id) => {
    const item = fixture.expectedStarfall.starNodes.find((node) => node.id === id);
    return { id: item.id, text: item.text, kind: 'idea' };
  });
  return graphApi.createGraphFromBubble({ id: source.id, text: source.text, kind: 'idea' }, {
    messages: [turn.text].concat(bubbles.map((bubble) => bubble.text).join(' ')),
    bubbles: [{ id: source.id, text: source.text }].concat(bubbles),
  });
}

test('DeliData 网络布局可复现，但不是规则列或网格', () => {
  const graph = publicGraph();
  const first = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  const second = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  assert.deepEqual(first, second);
  const points = Object.values(first);
  assert.ok(points.length >= 3);
  assert.equal(new Set(points.map((point) => point.x.toFixed(2))).size, points.length);
  assert.equal(new Set(points.map((point) => point.y.toFixed(2))).size, points.length);
});

test('新增候选从父节点周围涌现，并保留已有节点位置', () => {
  let graph = publicGraph();
  const before = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  const result = demo.expand({ node: graph.nodes[0], action: 'alternatives', count: 3 });
  const added = graphApi.addExpansion(graph, graph.rootId, 'alternatives', result.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = added.graph;
  const after = organic.createOrganicLayout(graph, { width: 1200, height: 760, existing: before });
  assert.deepEqual(after[graph.rootId].x, before[graph.rootId].x);
  assert.deepEqual(after[graph.rootId].y, before[graph.rootId].y);
  added.addedIds.forEach((id) => {
    const parent = after[graph.rootId];
    const child = after[id];
    const distance = Math.hypot(child.x - parent.x, child.y - parent.y);
    assert.ok(distance >= 140 && distance <= 230);
  });
});

test('自动舒展长期运行保持有限速度和坐标，不发散成 NaN', () => {
  const graph = publicGraph();
  let positions = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  for (let i = 0; i < 300; i++) {
    positions = organic.stepOrganicLayout(positions, graph.edges, 0.05, { time: i / 20, width: 1200, height: 760 });
  }
  Object.values(positions).forEach((point) => {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(Number.isFinite(point.vx) && Number.isFinite(point.vy));
    assert.ok(Math.hypot(point.vx, point.vy) <= 48.0001);
  });
});

test('拖拽固定节点不会被自动流场抢走，曲线不是机械直线', () => {
  const graph = publicGraph();
  const positions = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  const root = positions[graph.rootId];
  const next = organic.stepOrganicLayout(positions, graph.edges, 0.04, { pinnedId: graph.rootId, width: 1200, height: 760 });
  assert.equal(next[graph.rootId].x, root.x);
  assert.equal(next[graph.rootId].y, root.y);
  const edge = graph.edges[0];
  const curve = organic.curvedEdge(next[edge.from], next[edge.to], edge, 1);
  assert.match(curve.d, /Q/);
  assert.ok(Number.isFinite(curve.labelX) && Number.isFinite(curve.labelY));
});


test('原界面新增节点从父节点连续展开而不是瞬移到远处', () => {
  let graph = publicGraph();
  const before = organic.createOrganicLayout(graph, { width: 1200, height: 760 });
  const result = demo.expand({ node: graph.nodes[0], action: 'alternatives', count: 3 });
  const added = graphApi.addExpansion(graph, graph.rootId, 'alternatives', result.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = added.graph;
  let positions = organic.createOrganicLayout(graph, { width: 1200, height: 760, existing: before, enteringIds: added.addedIds });
  added.addedIds.forEach((id) => {
    const parent = positions[graph.rootId];
    const child = positions[id];
    assert.ok(Math.hypot(child.x - parent.x, child.y - parent.y) < 30);
    assert.equal(child.emerge, 0);
  });
  for (let i = 0; i < 120; i++) {
    positions = organic.stepOrganicLayout(positions, graph.edges, 1 / 30, { time: i / 30, width: 1200, height: 760 });
  }
  added.addedIds.forEach((id) => {
    const parent = positions[graph.rootId];
    const child = positions[id];
    assert.equal(child.emerge, 1);
    assert.ok(Math.hypot(child.x - parent.x, child.y - parent.y) > 120);
    assert.ok(Number.isFinite(child.x) && Number.isFinite(child.y));
  });
});
