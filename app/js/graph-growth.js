(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.graphGrowth = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function activeNode(node) {
    return node && node.status !== 'rejected' && !String(node.id).endsWith('__source');
  }

  function frontierNodes(graph) {
    const outgoing = new Set();
    graph.edges.forEach((edge) => {
      if (edge.status !== 'rejected' && edge.type !== 'cooccurrence') outgoing.add(edge.from);
    });
    return graph.nodes.filter((node) => activeNode(node) && !outgoing.has(node.id));
  }

  function kindEntropy(nodes) {
    const counts = new Map();
    nodes.forEach((node) => counts.set(node.kind, (counts.get(node.kind) || 0) + 1));
    const total = nodes.length;
    if (!total || counts.size <= 1) return 0;
    let entropy = 0;
    counts.forEach((count) => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });
    return entropy / Math.log2(counts.size);
  }

  function computeGrowth(graph, options) {
    const opts = options || {};
    const baseline = graph.nodes.filter((node) => activeNode(node) && node.sourceOrigin !== 'ai').length;
    const frontier = frontierNodes(graph).length;
    const accepted = graph.nodes.filter((node) => activeNode(node) && node.sourceOrigin === 'ai' && node.status === 'accepted').length;
    const rejected = graph.nodes.filter((node) => node.sourceOrigin === 'ai' && node.status === 'rejected').length;
    const pending = graph.nodes.filter((node) => activeNode(node) && node.sourceOrigin === 'ai' && node.status === 'candidate').length;
    const stats = graph.expansionStats || {};
    const generated = Number(stats.generated) || 0;
    const skippedDuplicates = Number(stats.skippedDuplicates) || 0;
    const maxDepth = graph.nodes.filter(activeNode).reduce((depth, node) => Math.max(depth, Number(node.depth) || 0), 0);
    const amount = opts.amount == null ? 2 : Math.max(0, Math.min(3, Number(opts.amount) || 0));
    return {
      baselineBoundary: Math.max(1, baseline),
      currentBoundary: frontier,
      acceptedExpansions: accepted,
      boundaryExpansionRate: accepted / Math.max(1, baseline),
      acceptanceRate: accepted + rejected ? accepted / (accepted + rejected) : null,
      duplicateRate: generated + skippedDuplicates ? skippedDuplicates / (generated + skippedDuplicates) : 0,
      generated,
      added: Number(stats.added) || accepted,
      skippedDuplicates,
      pending,
      maxDepth,
      kindEntropy: kindEntropy(frontierNodes(graph)),
      amount,
      model: 'project-defined-boundary-growth-v1'
    };
  }

  return { computeGrowth, frontierNodes, kindEntropy };
});
