(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldNatural = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const NATURAL_PALETTE = {
    ivory: '#eef1e8',
    mistCyan: '#d5e6e2',
    lilac: '#e4ddec',
    sage: '#d6e3cf',
    apricot: '#efd3ad',
    ink: '#24352f',
  };

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function crackProgress(elapsed, reducedMotion) {
    const progress = Math.max(0, Math.min(1, (Number(elapsed) || 0) / 650));
    return reducedMotion ? (progress >= 1 ? 1 : 0) : progress;
  }

  function burstVectors(seed, count) {
    const total = Math.max(2, Math.min(3, count || 2));
    const base = Number(seed) || 1;
    return Array.from({ length: total }, (_, index) => {
      const angle = -Math.PI / 2 + index / total * Math.PI * 2 + Math.sin(base * 1.7) * 0.18;
      const speed = 22 + (base * 13 + index * 11) % 17;
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        phase: base * 0.37 + index * 1.9,
      };
    });
  }

  function burstMotion(birth, elapsed, reducedMotion) {
    if (reducedMotion) return { x: birth.vx, y: birth.vy, rotation: 0, opacity: 1, scale: 1, done: true };
    const time = Math.max(0, Number(elapsed) || 0);
    const progress = 1 - Math.exp(-2.4 * time);
    const fade = smoothstep(time / 0.45);
    const settle = 1 - smoothstep(time / 1.2);
    return {
      x: birth.vx * progress,
      y: birth.vy * progress,
      rotation: Math.sin(time * 3.1 + birth.phase) * 4 * settle,
      opacity: fade,
      scale: 0.55 + smoothstep(time / 0.8) * 0.45,
      done: time >= 1.2,
    };
  }

  return { NATURAL_PALETTE, crackProgress, burstVectors, burstMotion };
});
