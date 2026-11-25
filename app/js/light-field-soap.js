(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldSoap = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function random01(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function clusteredLayout(bubbles, options) {
    const opts = options || {};
    const placed = [];
    bubbles.forEach((bubble, index) => {
      const group = bubble.current ? 0 : bubble.group == null ? index % (opts.groupCount || 3) : bubble.group;
      let candidate = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const key = (opts.seed || 37) + index * 97 + attempt * 19;
        const spread = bubble.current ? 12 : 20;
        const centerX = 22 + (group % 3) * 27 + (random01((opts.seed || 37) + group * 41) - 0.5) * 14;
        const centerY = 28 + (group % 2) * 39 + (random01((opts.seed || 37) + group * 53) - 0.5) * 16;
        const point = {
          x: Math.max(8, Math.min(92, centerX + (random01(key) + random01(key + 2) - 1) * spread)),
          y: Math.max(10, Math.min(90, centerY + (random01(key + 5) + random01(key + 7) - 1) * spread)),
        };
        const collision = placed.some((other) => {
          const dx = (point.x - other.x) / 100 * (opts.width || 1200);
          const dy = (point.y - other.y) / 100 * (opts.height || 800);
          const required = (bubble.radius || 24) + (other.radius || 24) + 8;
          return Math.hypot(dx, dy) < required;
        });
        if (!collision) { candidate = point; break; }
        candidate = point;
      }
      placed.push(Object.assign({}, bubble, candidate, { group }));
    });
    return placed;
  }

  function groupLinks(bubbles, threshold) {
    const limit = threshold == null ? 24 : threshold;
    const links = [];
    const groups = new Set(bubbles.map((bubble) => bubble.group));
    groups.forEach((group) => {
      const members = bubbles.filter((bubble) => bubble.group === group);
      members.forEach((bubble) => {
        const others = members.filter((other) => other.id !== bubble.id);
        if (!others.length) return;
        others.sort((a, b) => {
          const da = Math.hypot(a.x - bubble.x, a.y - bubble.y);
          const db = Math.hypot(b.x - bubble.x, b.y - bubble.y);
          return da - db;
        });
        const other = others[0];
        if (bubble.id > other.id) return;
        const distance = Math.hypot(other.x - bubble.x, other.y - bubble.y);
        const strength = Math.max(0, 1 - distance / limit);
        if (strength > 0) links.push({ a: bubble.id, b: other.id, group, distance, strength: strength * strength });
      });
    });
    return links;
  }

  function groupFlow(group, time) {
    const phase = (Number(time) || 0) * 0.035 + group * 1.7;
    return { x: Math.sin(phase) * 2.2, y: Math.cos(phase * 0.83) * 1.8 };
  }

  function filmColor(category, time, coherence) {
    const base = category === 'function' ? 218 : category === 'direction' ? 34 : 166;
    const flow = Math.sin((Number(time) || 0) * 0.08 + base) * 28;
    const warm = Math.max(0, Math.min(1, Number(coherence) || 0)) * 24;
    return { h: base + flow + warm, s: category === 'function' ? 32 : 68, l: category === 'direction' ? 72 : 66 };
  }

  return { clusteredLayout, groupLinks, groupFlow, filmColor };
});
