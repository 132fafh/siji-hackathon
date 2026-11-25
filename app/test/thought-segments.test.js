'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../tests/fixtures/delidata-wason-constructive.json');
const segments = require('../js/thought-segments.js');

const raw = fixture.turns.map((turn) => turn.speaker + ': ' + turn.text).join('\n');
const extracted = segments.extractThoughtSegments(raw);

test('公开会话生成完整短句，不再把 the/is/to 等虚词单独成星', () => {
  assert.ok(extracted.includes('I think we should check all four cards'));
  assert.ok(extracted.includes('I am going with the last 2'));
  assert.ok(extracted.includes('At the very least we should definitely include the 3rd card'));
  assert.ok(extracted.includes('Why A?'));
  assert.equal(extracted.includes('the'), false);
  assert.equal(extracted.includes('is'), false);
  assert.equal(extracted.includes('to'), false);
});

test('主持、任务规则、同意和礼貌发言不进入星落，最终结论保留', () => {
  ['Ok, anything else?', 'ok', 'makes sense', 'sounds good to me', 'A it is', 'Thanks for the help', 'Thanks for being willing to listen!'].forEach((value) => {
    assert.equal(extracted.includes(value), false, value);
  });
  assert.equal(extracted.some((value) => value.startsWith('The rule is')), false);
  assert.ok(extracted.includes('So A is the way to go'));
});

test('条件句不因逗号被截断，否定与未知保留在完整短句中', () => {
  assert.ok(extracted.includes('If we flip our only apparent vowel and we find an even number, that is a pretty good indication to the rule right off the start'));
  assert.ok(extracted.includes('We do not know what is on the other side of that card'));
  assert.ok(extracted.some((value) => value.startsWith('None of the other cards')));
});

test('每个截取短句都能在公开原话中找到，不把演示改写冒充原文', () => {
  const originals = fixture.turns.map((turn) => turn.text);
  extracted.forEach((value) => {
    assert.ok(originals.some((original) => original.includes(value)), value);
  });
});
