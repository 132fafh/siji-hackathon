'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('../js/light-field-corpus.js');
const spots = require('../js/light-field-spots.js');
const fs = require('node:fs');
const path = require('node:path');

test('主节点与外围星点保持清晰的大小层次', () => {
  const desktop = corpus.responsiveSizeConfig(1440);
  const mobile = corpus.responsiveSizeConfig(390);
  assert.ok(desktop.currentMin >= 45 && desktop.currentMax <= 55);
  assert.ok(desktop.minRadius >= 16 && desktop.maxRadius <= 28);
  assert.ok(mobile.currentMin >= 55 && mobile.currentMax <= 70);
  assert.ok(mobile.minRadius >= 14 && mobile.maxRadius <= 22);
});

test('星点光晕可见且文字默认可读，交互时完全清晰', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'light-field.css'), 'utf8');
  assert.match(css, /\.light-star-halo \{[\s\S]*?radial-gradient/);
  assert.match(css, /\.light-bubble-text \{[\s\S]*?opacity: 0\.94/);
  assert.match(css, /\.light-bubble\.is-selected \.light-bubble-text[\s\S]*?opacity: 1/);
});

test('背景仅保留低透明多层柔光', () => {
  const list = spots.createLightSpots(3, 43);
  assert.equal(list.length, 3);
  assert.ok(list.every((spot) => spot.radius >= 18 && spot.radius <= 50));
  assert.ok(list.every((spot) => spot.baseAlpha >= 0.04 && spot.baseAlpha <= 0.12));
  assert.ok(list.every((spot) => spots.spotAlpha(spot, 8) <= spot.baseAlpha));
  const shader = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'light-field-renderer.js'), 'utf8');
  assert.match(shader, /haloWide/);
});
