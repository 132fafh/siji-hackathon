(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldStars = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function random01(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function seedValue(seed) {
    const text = String(seed == null ? 'star' : seed);
    let value = 0;
    for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
    return value || 1;
  }

  function starShape(seed) {
    const value = seedValue(seed);
    const points = [];
    const offset = random01(value) * 0.3;
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4 + offset;
      const outer = 34 + random01(value + i * 5) * 12;
      const inner = 7 + random01(value + i * 7) * 8;
      const radius = i % 2 === 0 ? outer : inner;
      points.push([50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius]);
    }
    const path = 'M' + points.map((point) => point.map((n) => n.toFixed(2)).join(' ')).join(' L') + ' Z';
    return { path, rotation: random01(value + 41) * 24 - 12, coreScale: 0.75 + random01(value + 43) * 0.5 };
  }

  function starOpacity(seed, time, focused) {
    if (focused) return 1;
    const value = seedValue(seed);
    const phase = random01(value + 17) * Math.PI * 2;
    const t = Number(time) || 0;
    const base = 0.62 + random01(value + 19) * 0.18;
    const breathe = Math.sin(t * 0.55 + phase) * 0.065;
    const scintillation = Math.sin(t * 1.37 + phase * 1.7) * 0.022;
    return Math.max(0.5, Math.min(0.92, base + breathe + scintillation));
  }

  function starFallTrajectory(group, time) {
    const t = Number(time) || 0;
    const phase = (Number(group) || 0) * 1.37;
    return {
      x: Math.sin(t * 0.025 + phase) * 4,
      y: Math.sin(t * 0.021 + phase * 0.7) * 3 + Math.cos(t * 0.013 + phase) * 1.5,
    };
  }

  function starRays(seed, count) {
    const value = seedValue(seed);
    return Array.from({ length: count || 12 }, (_, index) => {
      const angle = index / (count || 12) * Math.PI * 2 + random01(value + 3) * 0.35;
      const inner = 12 + random01(value + index * 7) * 16;
      const outer = inner + 8 + random01(value + index * 11) * 24;
      return {
        x1: 50 + Math.cos(angle) * inner,
        y1: 50 + Math.sin(angle) * inner,
        x2: 50 + Math.cos(angle) * outer,
        y2: 50 + Math.sin(angle) * outer,
        opacity: 0.12 + random01(value + index * 13) * 0.3,
      };
    });
  }

  function meteorTrail(seed, time) {
    const period = 48;
    const phase = ((Number(time) || 0) + random01(seedValue(seed)) * period) % period;
    const progress = phase / period;
    const opacity = Math.sin(progress * Math.PI) * 0.16;
    return {
      x: -10 + progress * 120,
      y: 78 - progress * 44,
      dx: 5 + random01(seedValue(seed) + 7) * 4,
      dy: -2 - random01(seedValue(seed) + 9) * 2,
      opacity: Math.max(0, opacity),
    };
  }

  function starLinkStyle(distance, time, threshold) {
    const limit = threshold == null ? 24 : threshold;
    const strength = Math.max(0, 1 - distance / limit);
    return {
      opacity: strength > 0 ? 0.24 + strength * 0.16 : 0,
      dashOffset: -((Number(time) || 0) * 1.2) % 100,
    };
  }

  function starburstMotion(birth, elapsed, reducedMotion) {
    if (reducedMotion) return { x: birth.vx, y: birth.vy, rotation: 0, opacity: 1, scale: 1, done: true };
    const time = Math.max(0, Number(elapsed) || 0);
    if (time >= 1.2) return { x: birth.vx, y: birth.vy, rotation: 0, opacity: 1, scale: 1, done: true };
    const progress = 1 - Math.exp(-2.4 * time);
    const settle = 1 - Math.min(1, time / 1.2);
    return {
      x: birth.vx * progress,
      y: birth.vy * progress,
      rotation: Math.sin(time * 3.1 + birth.phase) * 4 * settle,
      opacity: Math.min(1, time / 0.45),
      scale: 0.55 + Math.min(1, time / 0.8) * 0.45,
      done: time >= 1.2,
    };
  }

  return { starShape, starOpacity, starFallTrajectory, starRays, meteorTrail, starLinkStyle, starburstMotion };
});
