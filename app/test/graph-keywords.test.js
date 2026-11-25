'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const graphApi = require('../js/thought-graph.js');
const keywords = require('../js/graph-keywords.js');
const demo = require('../js/demo-expansion.js');

function publicGraph() {
  const source = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
  const bubbles = fixture.expectedStarfall.starNodes.map((item) => ({
    id: item.id,
    text: item.text,
    kind: item.kind === 'group_solution' ? 'conclusion' : item.kind === 'conditional_reason' ? 'premise' : item.kind === 'question' || item.kind === 'uncertainty' ? 'question' : item.kind === 'candidate_solution' ? 'idea' : 'evidence',
  }));
  return graphApi.createGraphFromBubble({ id: source.id, text: source.text, kind: 'idea' }, {
    messages: [fixture.turns.map((turn) => turn.text).join(' ')],
    bubbles: [{ id: source.id, text: source.text }].concat(bubbles),
  });
}

test('TextRank 从公开会话全图提取内容词，过滤英文虚词且分数有限', () => {
  const result = keywords.textRank(publicGraph().nodes);
  const tokens = Object.keys(result.scores);
  assert.ok(tokens.includes('card') || tokens.includes('cards'));
  assert.ok(tokens.includes('vowel'));
  assert.equal(tokens.includes('the'), false);
  assert.equal(tokens.includes('is'), false);
  Object.values(result.scores).forEach((score) => assert.ok(Number.isFinite(score) && score >= 0));
});

test('发言人前缀和通用词不会伪装成全图关键词', () => {
  const tokens = keywords.tokenize('Narwhal: We do not know the rule. Beaver: makes sense. good inc… 写下 先写 部分 元音');
  assert.equal(tokens.includes('narwhal'), false);
  assert.equal(tokens.includes('beaver'), false);
  assert.equal(tokens.includes('good'), false);
  assert.equal(tokens.includes('inc'), false);
  assert.equal(tokens.includes('写下'), false);
  assert.equal(tokens.includes('先写'), false);
  assert.equal(tokens.includes('部分'), false);
  assert.ok(tokens.includes('元音'));
});

test('连通分量保留大小信息，不会所有小话题都并列第一', () => {
  const result = keywords.textRank(publicGraph().nodes);
  const rounded = new Set(Object.values(result.scores).map((score) => score.toFixed(3)));
  assert.ok(rounded.size > 2);
});

test('个性化 PageRank 以当前节点为种子，关系权重不混同共现', () => {
  const graph = publicGraph();
  const scores = keywords.personalizedPageRank(graph, graph.rootId);
  assert.equal(scores[graph.rootId], 1);
  Object.values(scores).forEach((score) => assert.ok(score >= 0 && score <= 1));
  assert.ok(keywords.edgeWeight({ type: 'source' }) > keywords.edgeWeight({ type: 'cooccurrence' }));
  assert.equal(keywords.edgeWeight({ type: 'project', status: 'rejected' }), 0);
});

test('单参量 λ 改变 MMR 关键词顺序，聚焦模式保持相关度优先', () => {
  const graph = publicGraph();
  const relevant = keywords.computeGraphKeywords(graph, { exploration: 1, count: 3 });
  const diverse = keywords.computeGraphKeywords(graph, { exploration: 0, count: 3 });
  assert.equal(relevant.lambda, 1);
  assert.equal(diverse.lambda, 0);
  assert.notDeepEqual(relevant.keywords.map((item) => item.id), diverse.keywords.map((item) => item.id));
  assert.ok(relevant.keywords[0].relevance >= relevant.keywords[1].relevance);
  relevant.keywords.concat(diverse.keywords).forEach((item) => {
    assert.ok(Number.isFinite(item.mmrScore));
    assert.ok(item.redundancy >= 0 && item.redundancy <= 1);
  });
});

test('当前逻辑链按原话、父节点到 AI 候选连接，不借共现伪造因果', () => {
  let graph = publicGraph();
  const result = demo.expand({ node: graph.nodes[0], action: 'project', count: 1 });
  const added = graphApi.addExpansion(graph, graph.rootId, 'project', result.candidates, { actualMode: 'demo', timestamp: 100 });
  graph = added.graph;
  const path = keywords.focusPath(graph, added.addedIds[0]);
  assert.equal(path[0], graph.rootId + '__source');
  assert.equal(path[1], graph.rootId);
  assert.equal(path[2], added.addedIds[0]);
  assert.equal(path.length, 3);
});

test('偏好参量限制在 0–1，默认聚焦与探索平衡且节点不合并', () => {
  assert.equal(keywords.createFocusPreferences().exploration, 0.35);
  assert.equal(keywords.createFocusPreferences({ exploration: 0 }).exploration, 0);
  assert.equal(keywords.createFocusPreferences({ exploration: 2 }).exploration, 1);
  const result = keywords.computeGraphKeywords(publicGraph(), { exploration: 0.35 });
  assert.equal(new Set(result.nodes.map((node) => node.id)).size, result.nodes.length);
});
