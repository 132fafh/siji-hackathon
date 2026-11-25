(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldLife = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function createMotes(count, seed) {
    const total = Math.max(0, Math.min(6, Math.trunc(count == null ? 5 : count)));
    const baseSeed = seed == null ? 29 : seed;
    return Array.from({ length: total }, (_, index) => {
      const value = Math.sin((index + 1) * 91.17 + baseSeed * 13.31) * 43758.5453;
      const fraction = value - Math.floor(value);
      return {
        id: 'mote-' + index,
        period: 20 + (index * 7 + baseSeed) % 13,
        phase: (index / Math.max(1, total) + fraction * 0.12) * (20 + (index * 7 + baseSeed) % 13),
        offsetX: Math.sin(index * 2.17 + baseSeed) * 0.2,
        offsetY: Math.cos(index * 1.73 + baseSeed * 0.7) * 0.18,
        phaseX: index * 1.91 + fraction * 2.4,
        phaseY: index * 2.43 + fraction * 1.6,
        speed: 0.035 + (index % 3) * 0.008,
        breathPhase: fraction * Math.PI * 2,
      };
    });
  }

  function lifecycleAlpha(mote, time) {
    const cycle = (((Number(time) + mote.phase) % mote.period) + mote.period) % mote.period / mote.period;
    const birth = smoothstep(cycle / 0.14);
    const decay = 1 - smoothstep((cycle - 0.72) / 0.28);
    const breath = 0.76 + 0.24 * Math.sin(cycle * Math.PI * 2 + mote.breathPhase);
    return Math.max(0, Math.min(1, birth * decay * breath));
  }

  function motePosition(mote, time) {
    const t = Number(time) || 0;
    return {
      x: 0.5 + mote.offsetX + Math.sin(t * mote.speed + mote.phaseX) * 0.1 + Math.sin(t * mote.speed * 0.43 + mote.phaseY) * 0.035,
      y: 0.5 + mote.offsetY + Math.cos(t * mote.speed * 0.83 + mote.phaseY) * 0.09 + Math.sin(t * mote.speed * 0.37 + mote.phaseX) * 0.03,
    };
  }

  function sampleMote(mote, time, pointer) {
    const position = motePosition(mote, time);
    let alpha = lifecycleAlpha(mote, time);
    if (pointer) {
      const dx = position.x - (Number(pointer.x) || 0);
      const dy = position.y - (Number(pointer.y) || 0);
      const distanceSquared = dx * dx + dy * dy;
      const wake = Math.exp(-distanceSquared * 22) * (Number(pointer.energy) || 0) * 0.16;
      const glowX = pointer.afterglowX == null ? Number(pointer.x) || 0 : pointer.afterglowX;
      const glowY = pointer.afterglowY == null ? Number(pointer.y) || 0 : pointer.afterglowY;
      const glowDx = position.x - glowX;
      const glowDy = position.y - glowY;
      const afterglow = Math.exp(-(glowDx * glowDx + glowDy * glowDy) * 18) * (Number(pointer.afterglow) || 0) * 0.2;
      alpha += wake + afterglow;
    }
    return { id: mote.id, x: position.x, y: position.y, alpha: Math.min(1, alpha) };
  }

  function linkStrength(first, second, threshold) {
    const limit = threshold == null ? 0.22 : threshold;
    if (limit <= 0) return 0;
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const proximity = 1 - smoothstep(distance / limit);
    return proximity * Math.min(first.alpha == null ? 1 : first.alpha, second.alpha == null ? 1 : second.alpha);
  }

  function sampleMotes(motes, time, pointer, reducedMotion) {
    const staticTime = reducedMotion ? 12 : time;
    const staticPointer = reducedMotion ? null : pointer;
    return (motes || []).map((mote) => sampleMote(mote, staticTime, staticPointer));
  }

  return { createMotes, lifecycleAlpha, motePosition, sampleMote, linkStrength, sampleMotes };
});
