(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.organicLayout = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function hash(value) {
    const text = String(value || 'node');
    let result = 2166136261;
    for (let i = 0; i < text.length; i++) {
      result ^= text.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0) / 4294967295;
  }

  function createOrganicLayout(graph, options) {
    const opts = options || {};
    const width = opts.width || 1200;
    const height = opts.height || 760;
    const existing = opts.existing || {};
    const enteringIds = new Set(opts.enteringIds || []);
    const rootId = graph.rootId;
    const positions = {};
    const nodes = graph.nodes.filter((node) => node.status !== 'rejected');
    const sorted = nodes.slice().sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    sorted.forEach((node, index) => {
      const saved = existing[node.id] || graph.positions && graph.positions[node.id];
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        positions[node.id] = {
          id: node.id,
          x: saved.x,
          y: saved.y,
          vx: Number(saved.vx) || 0,
          vy: Number(saved.vy) || 0,
          phase: hash(node.id) * Math.PI * 2,
          depth: node.depth,
          emerge: Number.isFinite(saved.emerge) ? saved.emerge : 1,
        };
        return;
      }
      if (node.id === rootId) {
        positions[node.id] = { id: node.id, x: width * 0.48, y: height * 0.48, vx: 0, vy: 0, phase: hash(node.id) * Math.PI * 2, depth: node.depth, emerge: 1 };
        return;
      }
      const parent = node.parentId && positions[node.parentId];
      const angleSeed = hash(node.id + '-angle');
      const angle = parent ? angleSeed * Math.PI * 2 : index * 2.399963 + angleSeed * 0.65;
      const distanceSeed = hash(node.id + '-distance');
      const entering = parent && enteringIds.has(node.id);
      const radius = entering ? 14 + distanceSeed * 8 : parent ? 145 + distanceSeed * 70 : 175 + node.depth * 58 + distanceSeed * 75;
      const centerX = parent ? parent.x : width * 0.48;
      const centerY = parent ? parent.y : height * 0.48;
      positions[node.id] = {
        id: node.id,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.76,
        vx: 0,
        vy: 0,
        phase: angleSeed * Math.PI * 2,
        depth: node.depth,
        emerge: entering ? 0 : 1,
      };
    });
    return positions;
  }

  function clonePositions(positions) {
    const result = {};
    Object.keys(positions).forEach((id) => { result[id] = Object.assign({}, positions[id]); });
    return result;
  }

  function easedEmergence(node) {
    const value = Number.isFinite(node.emerge) ? Math.max(0, Math.min(1, node.emerge)) : 1;
    return value * value * (3 - 2 * value);
  }

  function stepOrganicLayout(positions, edges, dt, options) {
    const opts = options || {};
    const next = clonePositions(positions);
    const ids = Object.keys(next);
    const time = Number(opts.time) || 0;
    const delta = Math.max(0.001, Math.min(0.04, Number(dt) || 1 / 60));
    const width = opts.width || 1400;
    const height = opts.height || 900;
    const centerX = width * 0.48;
    const centerY = height * 0.48;
    const acceleration = {};

    ids.forEach((id) => {
      const node = next[id];
      node.emerge = Math.min(1, (Number.isFinite(node.emerge) ? node.emerge : 1) + delta / 0.9);
      acceleration[id] = {
        x: (centerX - node.x) * 0.16 + Math.sin(time * 0.19 + node.phase) * 0.8,
        y: (centerY - node.y) * 0.16 + Math.cos(time * 0.17 + node.phase * 1.3) * 0.8,
      };
      if (node.x < 65) acceleration[id].x += (65 - node.x) * 3;
      if (node.x > width - 65) acceleration[id].x -= (node.x - width + 65) * 3;
      if (node.y < 60) acceleration[id].y += (60 - node.y) * 3;
      if (node.y > height - 60) acceleration[id].y -= (node.y - height + 60) * 3;
    });

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = next[ids[i]];
        const b = next[ids[j]];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          dx = Math.cos(a.phase) * 0.1;
          dy = Math.sin(a.phase) * 0.1;
          distance = 0.1;
        }
        const minimum = 64 + 136 * Math.min(easedEmergence(a), easedEmergence(b));
        if (distance >= minimum) continue;
        const force = (minimum - distance) * 2.1;
        const nx = dx / distance;
        const ny = dy / distance;
        acceleration[a.id].x -= nx * force;
        acceleration[a.id].y -= ny * force;
        acceleration[b.id].x += nx * force;
        acceleration[b.id].y += ny * force;
      }
    }

    (edges || []).forEach((edge) => {
      const a = next[edge.from];
      const b = next[edge.to];
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const baseTarget = edge.type === 'source' ? 195 : edge.type === 'cooccurrence' ? 180 : 190;
      const target = baseTarget * (0.12 + 0.88 * Math.min(easedEmergence(a), easedEmergence(b)));
      const force = (distance - target) * 0.42;
      const nx = dx / distance;
      const ny = dy / distance;
      acceleration[a.id].x += nx * force;
      acceleration[a.id].y += ny * force;
      acceleration[b.id].x -= nx * force;
      acceleration[b.id].y -= ny * force;
    });

    ids.forEach((id) => {
      const node = next[id];
      if (id === opts.pinnedId) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.vx = (node.vx + acceleration[id].x * delta) * Math.pow(0.9, delta * 60);
      node.vy = (node.vy + acceleration[id].y * delta) * Math.pow(0.9, delta * 60);
      const speed = Math.hypot(node.vx, node.vy);
      const speedLimit = node.emerge < 1 ? 72 : 48;
      if (speed > speedLimit) {
        node.vx = node.vx / speed * speedLimit;
        node.vy = node.vy / speed * speedLimit;
      }
      node.x += node.vx * delta;
      node.y += node.vy * delta;
    });
    return next;
  }

  function curvedEdge(from, to, edge, time) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const direction = hash(edge.id) > 0.5 ? 1 : -1;
    const bend = direction * Math.min(65, distance * 0.18) + Math.sin((Number(time) || 0) * 0.13 + hash(edge.id) * 8) * 4;
    const controlX = (from.x + to.x) / 2 - dy / distance * bend;
    const controlY = (from.y + to.y) / 2 + dx / distance * bend;
    return {
      d: 'M' + from.x.toFixed(2) + ',' + from.y.toFixed(2) + ' Q' + controlX.toFixed(2) + ',' + controlY.toFixed(2) + ' ' + to.x.toFixed(2) + ',' + to.y.toFixed(2),
      labelX: controlX,
      labelY: controlY,
    };
  }

  return { createOrganicLayout, stepOrganicLayout, curvedEdge };
});
