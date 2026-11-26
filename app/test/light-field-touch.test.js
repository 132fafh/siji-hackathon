'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '..', 'js', 'views-lightfield.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'light-field.css'), 'utf8');

test('星点使用标准 click 打开导图，拖拽和长按后的残余点击被抑制', () => {
  assert.match(view, /button\.addEventListener\('click', \(\) => \{/);
  assert.match(view, /button\.dataset\.suppressClick = 'true'/);
  assert.match(view, /if \(button\.dataset\.suppressClick === 'true'\)/);
  const pointerUp = view.match(/button\.addEventListener\('pointerup',[\s\S]*?button\.addEventListener\('pointercancel'/);
  assert.ok(pointerUp);
  assert.doesNotMatch(pointerUp[0], /openMap\(id\)/);
});

test('空白涡流由拖动轨迹触发，单击空白不再注入', () => {
  assert.match(view, /stageDrag\.active && emittedDistance >= 36/);
  assert.match(view, /colorField\.dragNormalized/);
  const stageUp = view.match(/function onStagePointerUp[\s\S]*?function onStagePointerLeave/);
  assert.ok(stageUp);
  assert.match(stageUp[0], /pointerUp\(event\.clientX, event\.clientY, false/);
  assert.doesNotMatch(stageUp[0], /pointerUp\(event\.clientX, event\.clientY, true/);
});

test('移动端扩大触控热区并将长句限制为两行', () => {
  const mobile = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
  assert.ok(mobile);
  assert.match(mobile[0], /\.light-bubble::before/);
  assert.match(mobile[0], /inset: -10px/);
  assert.match(mobile[0], /-webkit-line-clamp: 2/);
  assert.match(mobile[0], /width: 96px/);
  assert.match(mobile[0], /max-width: 22vw/);
  assert.match(mobile[0], /\.light-bubble\.is-right-edge \.light-bubble-text,\n  \.light-bubble\.is-left-edge \.light-bubble-text \{[^}]*left: 50%;[^}]*text-align: center;[^}]*transform: translateX\(-50%\)/);
});
