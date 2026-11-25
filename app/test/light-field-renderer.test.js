'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../js/light-field-renderer.js');

function environment() {
  return {
    window: {
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 2,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
  };
}

function motionQuery() {
  return { matches: true, addEventListener() {}, removeEventListener() {} };
}

function canvasWith2d(context2d) {
  return {
    width: 0,
    height: 0,
    style: {},
    dataset: {},
    getContext(type) { return type === '2d' ? context2d : null; },
    addEventListener() {},
    removeEventListener() {},
  };
}

function context2dMock() {
  const gradient = { addColorStop() {} };
  return {
    fills: 0,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect() { this.fills++; },
  };
}

test('fragment shader 使用每像素颜色场、fbm、domain warping 和 pointer uniforms', () => {
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+float\s+u_time/);
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+vec2\s+u_resolution/);
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+vec2\s+u_pointer/);
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+float\s+u_pointerEnergy/);
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+float\s+u_pointerDown/);
  assert.match(renderer.FRAGMENT_SHADER, /uniform\s+vec2\s+u_click/);
  assert.match(renderer.FRAGMENT_SHADER, /gl_FragCoord\.xy/);
  assert.match(renderer.FRAGMENT_SHADER, /float\s+fbm\s*\(/);
  assert.match(renderer.FRAGMENT_SHADER, /vec2\s+warpDomain\s*\(/);
  assert.match(renderer.FRAGMENT_SHADER, /pointerLocal/);
  assert.match(renderer.FRAGMENT_SHADER, /clickRing/);
});

test('银白极光与柔光斑使用独立层次、透明度和连续轨迹', () => {
  assert.match(renderer.FRAGMENT_SHADER, /u_spots\[10\]/);
  assert.match(renderer.FRAGMENT_SHADER, /u_spotTint\[10\]/);
  assert.match(renderer.FRAGMENT_SHADER, /u_spotCount/);
  assert.match(renderer.FRAGMENT_SHADER, /distanceToSpot/);
  assert.match(renderer.FRAGMENT_SHADER, /haloWide/);
  assert.match(renderer.FRAGMENT_SHADER, /0\.027, 0\.029, 0\.033/);
  assert.doesNotMatch(renderer.FRAGMENT_SHADER, /milkBase|flowFilaments|nearMist|grain|shaftTexture|nearFilm|moteGlow/);
});

test('WebGL 不可用时回退到静态 Canvas，触摸 API 与释放均无异常', () => {
  const context2d = context2dMock();
  const canvas = canvasWith2d(context2d);
  let field;
  assert.doesNotThrow(() => { field = renderer.createColorField(canvas, motionQuery(), environment()); });
  assert.equal(field.mode, 'canvas');
  assert.equal(canvas.dataset.lightRenderer, 'canvas');
  assert.ok(context2d.fills > 0);
  assert.doesNotThrow(() => {
    field.pointerMove(100, 120, 'mouse');
    field.pointerDown(100, 120);
    field.pointerUp(100, 120, true, 'mouse');
    field.pulseNormalized(0.4, 0.5, 1);
    field.pointerLeave();
  });
  assert.doesNotThrow(() => field.dispose());
});

test('WebGL 初始化抛错时仍回退，不影响调用方', () => {
  const context2d = context2dMock();
  const canvas = canvasWith2d(context2d);
  const original = canvas.getContext;
  canvas.getContext = (type) => {
    if (type !== '2d') throw new Error('WebGL blocked');
    return original.call(canvas, type);
  };
  let field;
  assert.doesNotThrow(() => { field = renderer.createColorField(canvas, motionQuery(), environment()); });
  assert.equal(field.mode, 'canvas');
  assert.doesNotThrow(() => field.dispose());
});

test('Canvas 也不可用时使用静态 CSS 背景且不抛异常', () => {
  const canvas = canvasWith2d(null);
  let field;
  assert.doesNotThrow(() => { field = renderer.createColorField(canvas, motionQuery(), environment()); });
  assert.equal(field.mode, 'css');
  assert.match(canvas.style.background, /radial-gradient/);
  assert.doesNotThrow(() => field.dispose());
});
