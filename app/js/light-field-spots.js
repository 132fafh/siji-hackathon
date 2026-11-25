(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldSpots = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function random01(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function createLightSpots(count, seed) {
    const total = Math.max(1, Math.min(10, Math.trunc(count || 8)));
    const base = seed == null ? 43 : seed;
    return Array.from({ length: total }, (_, index) => {
      const key = base + index * 19;
      return {
        id: 'spot-' + index,
        x: random01(key),
        y: random01(key + 3),
        radius: 18 + random01(key + 5) * 32,
        baseAlpha: 0.04 + random01(key + 7) * 0.08,
        breathSpeed: 0.003 + random01(key + 9) * 0.008,
        phase: random01(key + 11) * Math.PI * 2,
        vx: (random01(key + 13) - 0.5) * 5,
        vy: (random01(key + 17) - 0.5) * 5,
        tint: random01(key + 21),
      };
    });
  }

  function wrapCoordinate(value, min, max) {
    const span = max - min;
    return ((value - min) % span + span) % span + min;
  }

  function spotPosition(spot, time, viewport) {
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const radius = spot.radius * 2.5;
    return {
      x: wrapCoordinate(spot.x * width + spot.vx * time, -radius, width + radius) / width,
      y: wrapCoordinate(spot.y * height + spot.vy * time, -radius, height + radius) / height,
    };
  }

  function spotAlpha(spot, time) {
    return spot.baseAlpha * (0.84 + 0.16 * Math.sin(time * spot.breathSpeed * Math.PI * 2 + spot.phase));
  }

  function sampleSpots(spots, time, viewport, reducedMotion) {
    const t = reducedMotion ? 12 : Number(time) || 0;
    return (spots || []).map((spot) => {
      const position = spotPosition(spot, t, viewport);
      return { id: spot.id, x: position.x, y: position.y, radius: spot.radius, alpha: spotAlpha(spot, t), tint: spot.tint };
    });
  }

  return { createLightSpots, wrapCoordinate, spotPosition, spotAlpha, sampleSpots };
});
