(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode ? factory(require('./graph-keywords.js')) : factory(root.SJ.graphKeywords);
  if (isNode) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.graphExpansionGuard = api;
})(typeof window !== 'undefined' ? window : globalThis, function (keywords) {
  'use strict';

  function normalizedText(text) {
    return String(text || '').toLocaleLowerCase().replace(/[\s，。！？；、,.!?;：:（）()\[\]【】「」『』"'‘’“”…·\-—_]/g, '');
  }

  function numberSignature(text) {
    return String(text || '').match(/[0-9]+|[一二三四五六七八九十]+/g) || [];
  }

  function polaritySignature(text) {
    const value = String(text || '');
    return /不|没有|并非|不是|\bnot\b|\bno\b|\bnever\b/i.test(value) ? 'negative' : 'plain';
  }

  function tokenSimilarity(first, second) {
    const a = new Set(keywords.tokenize(first));
    const b = new Set(keywords.tokenize(second));
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((token) => { if (b.has(token)) shared++; });
    return 2 * shared / (a.size + b.size);
  }

  function duplicateScore(first, second) {
    const a = normalizedText(first);
    const b = normalizedText(second);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (numberSignature(a).join('|') !== numberSignature(b).join('|')) return 0;
    if (polaritySignature(a) !== polaritySignature(b)) return 0;
    if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 12 && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.65) return 0.92;
    return tokenSimilarity(a, b);
  }

  function ancestorIds(graph, parentId) {
    const result = [];
    const visited = new Set();
    let current = graph.nodes.find((node) => node.id === parentId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.push(current.id);
      current = current.parentId ? graph.nodes.find((node) => node.id === current.parentId) : null;
    }
    return result;
  }

  function dedupeCandidates(graph, candidates, options) {
    const opts = options || {};
    const threshold = opts.threshold == null ? 0.82 : opts.threshold;
    const allowedIds = opts.ancestorsOnly ? new Set(ancestorIds(graph, opts.parentId)) : null;
    const existing = graph.nodes.filter((node) => !allowedIds || allowedIds.has(node.id));
    const kept = [];
    const duplicates = [];
    (candidates || []).forEach((candidate) => {
      const text = String(candidate && candidate.text || '').trim();
      if (!text) return;
      const match = existing.map((node) => ({
        node,
        score: duplicateScore(text, node.fullText && node.fullText.length < 500 ? node.fullText : node.text),
      })).filter((item) => item.score >= threshold).sort((a, b) => b.score - a.score)[0];
      const selfDuplicate = kept.map((item) => ({
        item,
        score: duplicateScore(text, item.text),
      })).filter((entry) => entry.score >= threshold)[0];
      if (match || selfDuplicate) {
        duplicates.push({
          text,
          existingId: match ? match.node.id : selfDuplicate.item.id,
          existingText: match ? match.node.text : selfDuplicate.item.text,
          similarity: match ? match.score : selfDuplicate.score,
        });
      } else {
        kept.push(Object.assign({}, candidate, { text }));
      }
    });
    return { kept, duplicates };
  }

  return { normalizedText, duplicateScore, dedupeCandidates, ancestorIds };
});
