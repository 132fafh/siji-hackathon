'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/delidata-wason-constructive.json');
const corpus = require('../app/js/light-field-corpus.js');
const thoughts = require('../app/js/light-field-thoughts.js');
const demo = require('../server/demo-ai.js');

const turns = fixture.turns;
const expected = fixture.expectedStarfall;
const nodes = expected.starNodes;
const turnById = new Map(turns.map((turn) => [turn.id, turn]));
const nodeById = new Map(nodes.map((node) => [node.id, node]));
const messages = turns.map((turn) => ({ id: turn.id, text: turn.text }));

test('DeliData 固定案例保留公开来源、15 条原话及原始角色标注', () => {
  assert.equal(fixture.caseId, 'delidata-wason-table12-constructive');
  assert.match(fixture.source.url, /2108\.05271v3/);
  assert.match(fixture.source.location, /Table 12/);
  assert.equal(turns.length, 15);
  assert.equal(new Set(turns.map((turn) => turn.id)).size, turns.length);
  assert.equal(turns[0].text, 'I think we should check all four cards.');
  assert.equal(turns[14].text, 'Thanks for being willing to listen!');
  assert.deepEqual(turns[4].additionalLabels, []);
  assert.equal(turns[4].role, 'Reasoning');
});

test('每个星点短句都是对应发言的连续原文，中文仅作为展示译文', () => {
  nodes.forEach((node) => {
    const source = turnById.get(node.sourceTurnId);
    assert.ok(source, node.id + ' 必须有来源发言');
    assert.ok(source.text.toLocaleLowerCase().includes(node.text.toLocaleLowerCase()), node.id + ' 的英文短句必须逐字来自原话');
    assert.ok(node.displayZh, node.id + ' 必须有中文展示标签');
    assert.equal(thoughts.sourceSnippet(node.displayZh, [source.text]).found, false, '译文不能冒充英文原话');
  });
});

test('候选方案可以属于同一星团，但语义相近时仍不得合并答案', () => {
  const cluster = expected.clusters.find((item) => item.id === 'candidate-solutions');
  assert.equal(cluster.mustKeepDistinct, true);
  assert.equal(cluster.nodeIds.length, 3);
  assert.equal(new Set(cluster.nodeIds.map((id) => nodeById.get(id).sourceTurnId)).size, 3);
  const frequencies = corpus.corpusFrequencies(messages, cluster.nodeIds.map((id) => nodeById.get(id).text));
  assert.deepEqual(frequencies.map((row) => row.count), [1, 1, 1]);
  const alternatives = expected.relations.filter((relation) => relation.type === 'alternative_to');
  assert.equal(alternatives.length, 3);
  alternatives.forEach((relation) => {
    assert.ok(cluster.nodeIds.includes(relation.from) && cluster.nodeIds.includes(relation.to));
    assert.notEqual(relation.from, relation.to);
  });
});

test('追问、理由和最终结论构成可追溯关系，同意事件不替代结论', () => {
  expected.relations.forEach((relation) => {
    assert.ok(nodeById.has(relation.from), relation.from + ' 不存在');
    assert.ok(nodeById.has(relation.to), relation.to + ' 不存在');
  });
  assert.ok(expected.relations.some((relation) => relation.from === 'question-why-a' && relation.type === 'probes'));
  const supports = expected.relations.filter((relation) => relation.to === 'solution-final-a' && relation.type === 'supports');
  assert.equal(supports.length, 4);
  assert.deepEqual(expected.confirmationTurnIds, ['turn-12', 'turn-13']);
  expected.confirmationTurnIds.forEach((id) => assert.equal(turnById.get(id).role, 'Agree'));
});

test('任务规则、主持、同意和礼貌用语不会被误当成想法星点', () => {
  const nonStarTurnIds = new Set(expected.eventOnlyTurns.concat(expected.referenceOnlyTurns).map((item) => item.turnId));
  nodes.forEach((node) => assert.equal(nonStarTurnIds.has(node.sourceTurnId), false, node.id + ' 不应来自事件或规则发言'));
  assert.equal(expected.eventOnlyTurns.filter((item) => item.eventType === 'courtesy').length, 2);
  assert.equal(expected.referenceOnlyTurns[0].turnId, 'turn-06');
});

test('长按第三张牌的理由时，分裂候选来自同一条真实发言', () => {
  const parent = nodeById.get('reason-third-vowel');
  const siblings = ['reason-back-unknown', 'reason-flip-tests-rule'].map((id) => nodeById.get(id).text);
  const related = corpus.cooccurrenceCandidates(parent.text, [turnById.get('turn-07').text], siblings);
  assert.deepEqual(related.map((item) => item.text), siblings);
  related.forEach((item) => {
    assert.equal(item.source, 'cooccurrence');
    assert.equal(item.evidenceCount, 1);
  });
});

test('字面检索能返回目标 turn ID 与未改写证据，但不冒充语义排序', () => {
  const result = demo.recall('What is on the other side of that card?', messages);
  const target = result.evidence.find((item) => item.id === 'turn-07');
  assert.ok(target, '目标原话必须保留在候选证据中');
  assert.equal(target.text, turnById.get('turn-07').text);
  assert.ok(target.score > 0);
  assert.equal(result.evidence[0].id, 'turn-06', '记录当前字面 Dice 的已知排序限制，供后续向量检索回归对照');
  assert.match(result.uncertainty, /不表示真实遗忘概率/);
});
