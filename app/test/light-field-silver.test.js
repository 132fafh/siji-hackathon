'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = require('../js/light-field-renderer.js');
const stars = require('../js/light-field-stars.js');

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp('^' + escaped + '\\s*\\{([^}]+)\\}', 'm'));
  assert.ok(match, '缺少 CSS 规则：' + selector);
  return match[1];
}

test('银白极光只使用低色差冷白配色和自然噪声光带', () => {
  assert.match(renderer.FRAGMENT_SHADER, /float\s+silverAurora\s*\(/);
  assert.match(renderer.FRAGMENT_SHADER, /warpDomain\(p \* 1\.15/);
  const palettes = [
    /vec3\(0\.78, 0\.80, 0\.83\) \* aurora/,
    /vec3\(0\.91, 0\.92, 0\.93\) \* aurora/,
    /vec3\(0\.7, 0\.72, 0\.75\), vec3\(0\.84, 0\.85, 0\.87\)/,
  ];
  palettes.forEach((pattern) => assert.match(renderer.FRAGMENT_SHADER, pattern));
  assert.doesNotMatch(renderer.FRAGMENT_SHADER, /0\.45, 0\.55, 0\.85|0\.62, 0\.52, 0\.78/);
});

test('星辉透明度轻微连续闪烁，聚焦时完整亮起', () => {
  ['摄影', '云雾', '清晨'].forEach((word) => {
    const before = stars.starOpacity(word, 4, false);
    const after = stars.starOpacity(word, 4.05, false);
    assert.ok(before >= 0.5 && before <= 0.92);
    assert.ok(after >= 0.5 && after <= 0.92);
    assert.ok(Math.abs(before - after) < 0.02);
    assert.equal(stars.starOpacity(word, 4, true), 1);
  });
  assert.ok(stars.starLinkStyle(4, 8).opacity <= 0.4);
});

test('节点文字默认清晰可见且桌面移动尺寸达标', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'light-field.css'), 'utf8');
  assert.match(cssRule(css, '.light-bubble-text'), /font-size: 15px/);
  assert.match(cssRule(css, '.light-bubble-text'), /opacity: 0\.94/);
  assert.match(cssRule(css, '.light-bubble.is-current .light-bubble-text'), /font-size: 16px/);
  const mobile = css.match(/@media \(max-width: 640px\) \{([\s\S]*?)@media \(prefers-reduced-motion/)[1];
  assert.match(mobile, /\.light-bubble-text \{[\s\S]*?font-size: 13px/);
  assert.match(mobile, /\.light-bubble\.is-current \.light-bubble-text \{[^}]*font-size: 14px/);
});

test('星点使用柔和亮核、光晕和细芒而非实心四角星', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'js', 'views-lightfield.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'light-field.css'), 'utf8');
  assert.match(view, /light-star-halo/);
  assert.match(view, /light-star-rays/);
  assert.match(css, /\.light-star-core \{[\s\S]*?radial-gradient/);
  assert.match(css, /\.light-star-rays \{[\s\S]*?stroke-width: 0\.65/);
  assert.doesNotMatch(view, /meteor-trails/);
});
