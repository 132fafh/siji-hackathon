(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode
    ? factory(require('./preference-vector.js'), require('./graph-keywords.js'), require('./graph-expansion-guard.js'))
    : factory(root.SJ.preferenceVector, root.SJ.graphKeywords, root.SJ.graphExpansionGuard);
  if (isNode) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.graphExpansion = api;
})(typeof window !== 'undefined' ? window : globalThis, function (preferences, keywords, guard) {
  'use strict';

  function similarity(first, second) {
    const a = new Set(first);
    const b = new Set(second);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((token) => { if (b.has(token)) shared++; });
    return shared / (a.size + b.size - shared);
  }

  function boundaryState(graph, savedPreferences) {
    const prefs = preferences.createPreferences(savedPreferences);
    const nodes = (graph && graph.nodes) || [];
    const baseline = Math.max(1, nodes.filter((node) => node.status !== 'rejected' && node.sourceOrigin !== 'ai' && !String(node.id).endsWith('__source')).length);
    const accepted = nodes.filter((node) => node.sourceOrigin === 'ai' && node.status === 'accepted').length;
    const pending = nodes.filter((node) => node.sourceOrigin === 'ai' && node.status === 'candidate').length;
    const target = Math.ceil(baseline * prefs.boundaryTarget);
    return {
      baseline,
      accepted,
      pending,
      target,
      remaining: Math.max(0, target - accepted - pending),
      rate: accepted / baseline,
      limit: prefs.boundaryTarget,
    };
  }

  function remainingCapacity(graph, savedPreferences) {
    return boundaryState(graph, savedPreferences).remaining;
  }

  function select(graph, parentId, candidates, options) {
    const opts = options || {};
    const prefs = preferences.createPreferences(opts.preferences);
    const requested = [0, 1, 2, 3].includes(Number(opts.count)) ? Number(opts.count) : prefs.count;
    if (requested === 0) return { candidates: [], duplicates: [], reason: '扩展已暂停，现有网络没有改变。' };
    const boundary = boundaryState(graph, prefs);
    const count = Math.min(requested, boundary.remaining);
    if (count === 0) return { candidates: [], duplicates: [], boundary, reason: '已到边界扩张总率上限，可提高上限或拒绝一条候选来释放额度。' };
    const exploration = keywords.createFocusPreferences({ exploration: opts.exploration }).exploration;
    const focus = keywords.computeGraphKeywords(graph, { focusId: parentId, exploration, count: 3 });
    const parent = graph.nodes.find((node) => node.id === parentId) || graph.nodes.find((node) => node.id === graph.rootId);
    const parentTokens = keywords.tokenize(parent && (parent.fullText || parent.text));
    const deduped = guard.dedupeCandidates(graph, candidates);
    const ranked = preferences.rankCandidates(deduped.kept.map((candidate) => Object.assign({}, candidate, {
      action: candidate.action || opts.action,
    })), prefs).map((candidate, index) => {
      const tokens = keywords.tokenize(candidate.text);
      const directRelevance = similarity(tokens, parentTokens);
      const contextRelevance = focus.nodes.reduce((best, node) => {
        const structuralWeight = 0.5 + (focus.centrality[node.id] || 0);
        return Math.max(best, similarity(tokens, node.tokens) * structuralWeight);
      }, 0);
      const relevance = 0.6 * (candidate.preferenceScore / 100) + 0.22 * directRelevance + 0.18 * contextRelevance;
      return Object.assign({}, candidate, {
        id: candidate.id || candidate.text + '-' + index,
        relevance,
        tokens,
      });
    });
    const selected = keywords.selectWithMMR(ranked, exploration, (a, b) => similarity(a.tokens, b.tokens), count).map((candidate) => {
      const clean = Object.assign({}, candidate, {
        exploration,
        graphRelevance: Number(candidate.relevance.toFixed(4)),
      });
      delete clean.relevance;
      delete clean.tokens;
      return clean;
    });
    return {
      candidates: selected,
      duplicates: deduped.duplicates,
      boundary,
      reason: selected.length ? null : deduped.duplicates.length ? '这条路径已有相同或高度相近的候选，不再重复生成。' : '当前没有可添加的候选路径。',
    };
  }

  return { select, similarity, boundaryState, remainingCapacity };
});
