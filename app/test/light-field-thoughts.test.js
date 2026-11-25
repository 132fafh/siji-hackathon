'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const thoughts = require('../js/light-field-thoughts.js');

test('双击编辑保存关键词和补充想法且不修改 original', () => {
  const session = { id: 's1', original: { text: '原始表达不可变', ts: 1 }, lightThoughts: { old: { keyword: '旧词', note: '旧注' } } };
  const patch = thoughts.saveThoughtEdit(session, 'star-1', '  新关键词  ', '  补充一句想法  ', 100);
  assert.equal(patch.lightThoughts['star-1'].keyword, '新关键词');
  assert.equal(patch.lightThoughts['star-1'].note, '补充一句想法');
  assert.equal(patch.lightThoughts['star-1'].updatedAt, 100);
  assert.equal(session.original.text, '原始表达不可变');
  assert.equal(patch.lightThoughts.old.keyword, '旧词');
  assert.equal(thoughts.saveThoughtEdit(session, 'star-1', ' ', 'x'), null);
});

test('详情返回关键词、来源原话、相对频次和收束说明', () => {
  const detail = thoughts.detailForBubble({ text: '摄影', probability: 0.4, coherence: 0.8 }, { messages: ['我想整理山间摄影集'] });
  assert.equal(detail.keyword, '摄影');
  assert.equal(detail.source.found, true);
  assert.match(detail.source.snippet, /摄影/);
  assert.equal(detail.probability, 0.4);
  assert.equal(detail.coherence, 0.8);
  assert.match(detail.coherenceLabel, /启发式/);
});

test('缺少原话或关键词时明确不确定', () => {
  assert.equal(thoughts.sourceSnippet('不存在', ['真实原话']).found, false);
  assert.match(thoughts.sourceSnippet('不存在', ['真实原话']).snippet, /不确定/);
  assert.match(thoughts.sourceSnippet('', ['真实原话']).snippet, /无法确定/);
});
