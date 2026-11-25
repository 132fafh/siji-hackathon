(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldCorpus = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function normalized(text) {
    return String(text == null ? '' : text).trim().toLocaleLowerCase();
  }

  function messageText(message) {
    return typeof message === 'string' ? message : String(message && message.text || '');
  }

  function countOccurrences(text, keyword) {
    const haystack = normalized(text);
    const needle = normalized(keyword);
    if (!needle) return 0;
    let count = 0;
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      count++;
      index += needle.length;
    }
    return count;
  }

  function corpusFrequencies(messages, keywords) {
    const corpus = (messages || []).map(messageText);
    const seen = new Set();
    const unique = (keywords || []).filter((keyword) => {
      const key = normalized(keyword);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const rows = unique.map((text) => ({
      text: String(text).trim(),
      count: corpus.reduce((sum, message) => sum + countOccurrences(message, text), 0),
      probability: 0,
    }));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    rows.forEach((row) => { row.probability = total ? row.count / total : 0; });
    return rows;
  }

  function sizeForProbability(probability, options) {
    const opts = options || {};
    const min = opts.minRadius == null ? 14 : opts.minRadius;
    const max = opts.maxRadius == null ? 42 : opts.maxRadius;
    const p = Math.max(0, Math.min(1, Number(probability) || 0));
    return Math.round((min + Math.sqrt(p) * (max - min)) * 100) / 100;
  }

  function clampPosition(bubble, width, height) {
    const margin = 8;
    const minX = (bubble.radius + margin) / width * 100;
    const minY = (bubble.radius + margin) / height * 100;
    bubble.x = Math.max(minX, Math.min(100 - minX, bubble.x));
    bubble.y = Math.max(minY, Math.min(100 - minY, bubble.y));
  }

  function constrainLayout(bubbles, options) {
    const opts = options || {};
    const width = opts.width || 1000;
    const height = opts.height || 700;
    const padding = opts.padding == null ? 10 : opts.padding;
    const result = bubbles.map((bubble) => Object.assign({}, bubble));
    result.forEach((bubble) => clampPosition(bubble, width, height));
    for (let iteration = 0; iteration < 10; iteration++) {
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const first = result[i];
          const second = result[j];
          let dx = (second.x - first.x) / 100 * width;
          let dy = (second.y - first.y) / 100 * height;
          let distance = Math.hypot(dx, dy);
          const required = first.radius + second.radius + padding;
          if (distance >= required) continue;
          if (distance < 0.001) {
            dx = Math.cos((i + 1) * (j + 2));
            dy = Math.sin((i + 1) * (j + 2));
            distance = 1;
          }
          const movement = (required - distance) * 0.58;
          second.x += dx / distance * movement / width * 100;
          second.y += dy / distance * movement / height * 100;
          clampPosition(second, width, height);
        }
      }
    }
    return result;
  }

  function clickResize(bubbles, id, options) {
    const opts = options || {};
    const minRadius = opts.minRadius == null ? 12 : opts.minRadius;
    const maxRadius = opts.maxRadius == null ? 48 : opts.maxRadius;
    const archived = [];
    const resized = [];
    bubbles.forEach((bubble) => {
      const next = Object.assign({}, bubble);
      const radius = next.radius == null ? (next.size || 40) / 2 : next.radius;
      if (next.id === id) {
        next.radius = Math.min(maxRadius, Math.max(minRadius, radius * 1.12 + 0.8));
        next.size = next.radius * 2;
        resized.push(next);
      } else {
        const smaller = radius * 0.965;
        if (smaller < minRadius) archived.push(Object.assign(next, { radius, archivedReason: 'too-small' }));
        else {
          next.radius = smaller;
          next.size = next.radius * 2;
          resized.push(next);
        }
      }
    });
    return { bubbles: constrainLayout(resized, opts), archived };
  }

  function splitCount(keyword) {
    const text = normalized(keyword);
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return 2 + hash % 2;
  }

  function cooccurrenceCandidates(parent, messages, candidates, options) {
    const opts = options || {};
    const excluded = new Set((opts.exclude || []).map(normalized));
    const parentKey = normalized(parent);
    const corpus = (messages || []).map(messageText).filter((message) => normalized(message).includes(parentKey));
    const rows = (candidates || []).map((text, index) => {
      const key = normalized(text);
      const score = key && key !== parentKey && !excluded.has(key)
        ? corpus.reduce((sum, message) => sum + countOccurrences(message, text), 0)
        : 0;
      return { text: String(text).trim(), score, index };
    }).filter((row) => row.score > 0);
    rows.sort((a, b) => b.score - a.score || a.index - b.index);
    return rows.map((row) => ({
      text: row.text,
      source: 'cooccurrence',
      evidenceCount: row.score,
      relationLabel: '共现：与「' + parent + '」出现在同一用户消息中，不代表语义证明',
    }));
  }

  function splitCandidates(parent, messages, candidates, count, options) {
    const opts = options || {};
    const target = count || splitCount(parent);
    const selected = cooccurrenceCandidates(parent, messages, candidates, opts).slice(0, target);
    const used = new Set(selected.map((item) => normalized(item.text)));
    const excluded = new Set((opts.exclude || []).map(normalized));
    const candidateLabel = opts.candidateLabel || '当前用户语料候选词';
    excluded.add(normalized(parent));
    (candidates || []).forEach((candidate) => {
      const key = normalized(candidate);
      if (selected.length >= target || !key || used.has(key) || excluded.has(key)) return;
      used.add(key);
      selected.push({
        text: String(candidate).trim(),
        source: 'candidate',
        evidenceCount: 0,
        relationLabel: '候选来源：' + candidateLabel + '，没有与「' + parent + '」的共现证明',
      });
    });
    return selected;
  }

  function responsiveSizeConfig(width) {
    const value = Number(width) || 1024;
    if (value <= 640) return { minRadius: 14, maxRadius: 22, currentMin: 55, currentMax: 70, clickMaxRadius: 30 };
    if (value <= 1024) return { minRadius: 15, maxRadius: 26, currentMin: 45, currentMax: 55, clickMaxRadius: 36 };
    return { minRadius: 16, maxRadius: 28, currentMin: 45, currentMax: 55, clickMaxRadius: 40 };
  }

  function characterGrams(text) {
    const value = normalized(text).replace(/[\s，。！？；、,.!?;：:（）()\[\]【】]/g, '');
    if (value.length <= 2) return new Set(value ? [value] : []);
    const grams = new Set();
    for (let i = 0; i < value.length - 1; i++) grams.add(value.slice(i, i + 2));
    return grams;
  }

  function lexicalOverlap(first, second) {
    const a = characterGrams(first);
    const b = characterGrams(second);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((gram) => { if (b.has(gram)) shared++; });
    return shared / (a.size + b.size - shared);
  }

  function coherenceDetails(keyword, context) {
    const opts = context || {};
    const messages = (opts.messages || []).map(messageText).filter((message) => message.trim());
    const candidates = (opts.candidates || []).map((text) => String(text).trim()).filter((text, index, list) => text && list.indexOf(text) === index);
    const key = normalized(keyword);
    const containing = messages.filter((message) => normalized(message).includes(key));
    const neighborCounts = new Map();
    candidates.forEach((candidate) => {
      const candidateKey = normalized(candidate);
      if (!candidateKey || candidateKey === key) return;
      const count = containing.reduce((sum, message) => sum + countOccurrences(message, candidate), 0);
      if (count) neighborCounts.set(candidate, count);
    });
    const degree = Math.min(1, neighborCounts.size / Math.max(1, Math.min(5, candidates.length - 1)));
    const graphWeight = Array.from(neighborCounts.values()).reduce((sum, count) => sum + Math.min(3, count), 0);
    const graphConnection = degree * Math.min(1, graphWeight / 6);
    let overlap = 0;
    candidates.forEach((candidate) => {
      if (normalized(candidate) !== key) overlap = Math.max(overlap, lexicalOverlap(keyword, candidate));
    });
    const previous = normalized(opts.previousKeyword);
    let topicContinuity = Math.min(1, containing.length / Math.max(1, Math.min(3, messages.length)));
    if (previous) {
      const sharesMessage = containing.some((message) => normalized(message).includes(previous));
      topicContinuity = previous === key ? 1 : sharesMessage ? 0.85 : 0.15;
    }
    const score = Math.max(0, Math.min(1, degree * 0.34 + overlap * 0.2 + graphConnection * 0.26 + topicContinuity * 0.2));
    return { score, cooccurrence: degree, lexicalOverlap: overlap, graphConnection, topicContinuity };
  }

  function coherenceScore(keyword, context) {
    return coherenceDetails(keyword, context).score;
  }

  function coherenceColor(baseColor, score) {
    const amount = Math.max(0, Math.min(1, Number(score) || 0));
    const blend = Math.min(1, amount * amount * 1.45);
    const shade = 0.52 + 0.48 * Math.min(1, amount * 1.4);
    const darkBase = { r: baseColor.r * shade, g: baseColor.g * shade, b: baseColor.b * shade };
    const warm = { r: 244, g: 220, b: 172 };
    const ivory = { r: 250, g: 241, b: 219 };
    const target = amount > 0.72
      ? {
          r: warm.r + (ivory.r - warm.r) * (amount - 0.72) / 0.28,
          g: warm.g + (ivory.g - warm.g) * (amount - 0.72) / 0.28,
          b: warm.b + (ivory.b - warm.b) * (amount - 0.72) / 0.28,
        }
      : warm;
    return {
      r: Math.round(darkBase.r + (target.r - darkBase.r) * blend),
      g: Math.round(darkBase.g + (target.g - darkBase.g) * blend),
      b: Math.round(darkBase.b + (target.b - darkBase.b) * blend),
    };
  }

  function spatialCoherence(baseScore, distance) {
    const base = Math.max(0, Math.min(1, Number(baseScore) || 0));
    const proximity = Math.exp(-Math.max(0, Number(distance) || 0) / 32);
    return Math.max(0, Math.min(1, base * 0.82 + proximity * 0.18));
  }

  function flowVector(category, time) {
    const group = category === 'function' ? 1 : category === 'direction' ? 2 : 0;
    const angles = [-0.42, 2.85, 0.68];
    const speeds = [0.036, 0.029, 0.043];
    const phase = (Number(time) || 0) * speeds[group];
    return {
      x: Math.cos(angles[group]) * Math.sin(phase) * 5,
      y: Math.sin(angles[group]) * Math.sin(phase) * 5,
    };
  }

  function motionForBubble(bubble, time, reducedMotion) {
    if (reducedMotion) return { x: 0, y: 0, groupX: 0, groupY: 0 };
    const seedText = String(bubble.id || bubble.text || 'bubble');
    let seed = 0;
    for (let i = 0; i < seedText.length; i++) seed = (seed * 33 + seedText.charCodeAt(i)) >>> 0;
    const phase = (seed % 628) / 100;
    const t = Number(time) || 0;
    const group = flowVector(bubble.category || 'content', t);
    const x = group.x + Math.sin(t * 0.071 + phase) * 1.35 + Math.sin(t * 0.023 + phase * 1.7) * 2.05;
    const y = group.y + Math.cos(t * 0.063 + phase * 1.2) * 1.25 + Math.sin(t * 0.019 + phase * 1.4) * 1.85;
    return {
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000,
      groupX: Math.round(group.x * 10000) / 10000,
      groupY: Math.round(group.y * 10000) / 10000,
    };
  }

  function archiveBubble(box, bubble) {
    return (box || []).concat([Object.assign({}, bubble, { archived: true })]);
  }

  function restoreFromBox(box, id) {
    const list = box || [];
    const found = list.find((bubble) => bubble.id === id) || null;
    return {
      box: found ? list.filter((bubble) => bubble.id !== id) : list.slice(),
      bubble: found ? Object.assign({}, found, { archived: false }) : null,
    };
  }

  return {
    countOccurrences,
    corpusFrequencies,
    sizeForProbability,
    responsiveSizeConfig,
    coherenceDetails,
    coherenceScore,
    coherenceColor,
    spatialCoherence,
    flowVector,
    motionForBubble,
    constrainLayout,
    clickResize,
    splitCount,
    cooccurrenceCandidates,
    splitCandidates,
    archiveBubble,
    restoreFromBox,
  };
});
