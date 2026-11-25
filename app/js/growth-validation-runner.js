(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode
    ? factory(require('./thought-graph.js'), require('./demo-expansion.js'), require('./graph-growth.js'))
    : factory(root.SJ.thoughtGraph, root.SJ.demoExpansion, root.SJ.graphGrowth);
  if (isNode) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.growthValidation = api;
})(typeof window !== 'undefined' ? window : globalThis, function (graphApi, demo, growth) {
  'use strict';

  function snapshot(label, graph, detail) {
    return {
      label,
      detail,
      graph: JSON.parse(JSON.stringify(graph)),
      metrics: growth.computeGrowth(graph, { amount: 2 }),
    };
  }

  async function runGrowthValidation(options) {
    const opts = options || {};
    const data = opts.data || await SJ.publicDeliData.load();
    const source = data.expectedStarfall.starNodes.find((node) => node.id === 'solution-third-card');
    const turn = data.turns.find((item) => item.id === source.sourceTurnId);
    let graph = graphApi.createGraphFromBubble({ id: source.id, text: source.text, kind: 'idea' }, {
      session: { original: { text: turn.text } },
      messages: [turn.text],
    });
    const steps = [snapshot('基线：一个原始想法', graph, { amount: 0, generated: 0, skippedDuplicates: 0 })];

    function expand(label, action, count, exploration, acceptedIndices, rejectedIndices) {
      const result = demo.expand({
        node: graph.nodes[0],
        action,
        count,
        exploration,
        existingCandidates: graph.nodes,
      });
      const addition = graphApi.addExpansion(graph, graph.rootId, action, result.candidates, {
        actualMode: 'demo',
        timestamp: 100 + steps.length,
      });
      graph = addition.graph;
      if (Array.isArray(result.skippedDuplicates) && result.skippedDuplicates.length) {
        graph.expansionStats.skippedDuplicates += result.skippedDuplicates.length;
      }
      (acceptedIndices || []).forEach((index) => {
        if (addition.addedIds[index] != null) graph = graphApi.setCandidateStatus(graph, addition.addedIds[index], 'accepted');
      });
      (rejectedIndices || []).forEach((index) => {
        if (addition.addedIds[index] != null) graph = graphApi.setCandidateStatus(graph, addition.addedIds[index], 'rejected');
      });
      steps.push(snapshot(label, graph, {
        amount: count,
        exploration,
        generated: result.candidates.length,
        added: addition.addedIds.length,
        skippedDuplicates: addition.duplicates.length,
        reason: addition.reason || result.reason,
      }));
    }

    expand('第一次探索：接受 2 条，拒绝 1 条', 'alternatives', 3, 1, [0, 1], [2]);
    expand('第二次探索：不重复旧路径', 'alternatives', 3, 1, [], []);
    expand('第三次探索：候选池耗尽', 'alternatives', 3, 1, [], []);
    expand('换一条路径：接受 3 条', 'project', 3, 1, [0, 1, 2], []);
    expand('B=0：暂停扩展', 'project', 0, 1, [], []);

    return {
      caseId: data.caseId,
      source: data.source,
      model: 'project-defined-boundary-growth-v1',
      steps,
    };
  }

  return { run: runGrowthValidation };
});
