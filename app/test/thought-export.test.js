'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
require('../js/util.js');
const graph = require('../js/thought-graph.js');
const preferences = require('../js/preference-vector.js');
require('../js/graph-keywords.js');
require('../js/graph-growth.js');
const demo = require('../js/demo-expansion.js');
require('../js/export.js');

const item = fixture.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
const sourceTurn = fixture.turns.find((turn) => turn.id === item.sourceTurnId);

test('Markdown 导出保留公开原话、导图节点、AI 来源和候选状态', () => {
  const original = { text: sourceTurn.text, ts: 1 };
  let map = graph.createGraphFromBubble({ id: item.id, text: item.text, kind: 'idea' }, { messages: [sourceTurn.text] });
  const expansion = demo.expand({ node: map.nodes[0], action: 'alternatives', count: 2 });
  const added = graph.addExpansion(map, item.id, 'alternatives', expansion.candidates, { actualMode: 'demo', timestamp: 100 });
  map = graph.setCandidateStatus(added.graph, added.addedIds[0], 'accepted');
  map = graph.setCandidateStatus(map, added.addedIds[1], 'rejected');
  let prefs = preferences.createPreferences();
  prefs = preferences.applyFeedback(prefs, map.nodes.find((node) => node.id === added.addedIds[0]), true, 100);
  const session = {
    title: 'DeliData 公开测试',
    original,
    thoughtMaps: { [item.id]: map },
    expansionPreferences: prefs,
    focusPreferences: { exploration: 0.35 },
    rounds: [],
    createdAt: 1,
    updatedAt: 2,
  };
  const markdown = SJ.exporter.sessionToMarkdown(session);
  assert.match(markdown, /## 星落与局部思维导图/);
  assert.match(markdown, /AI 演示候选；已接受/);
  assert.match(markdown, /AI 演示候选；已拒绝/);
  assert.match(markdown, /关系：/);
  assert.match(markdown, /不是人格画像/);
  assert.doesNotMatch(markdown, /思维拓展量 B=|边界拓展率|候选接受率|重复拦截率/);
  assert.ok(markdown.includes(sourceTurn.text));
  assert.equal(original.text, sourceTurn.text);
});
