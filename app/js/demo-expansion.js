(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode
    ? factory(require('./thought-graph.js'), require('./preference-vector.js'), require('./graph-keywords.js'), require('./graph-expansion-guard.js'))
    : factory(root.SJ.thoughtGraph, root.SJ.preferenceVector, root.SJ.graphKeywords, root.SJ.graphExpansionGuard);
  if (isNode) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.demoExpansion = api;
})(typeof window !== 'undefined' ? window : globalThis, function (graph, preferences, keywords, guard) {
  'use strict';

  function short(text) {
    let value = String(text || '').replace(/\s+/g, ' ').trim();
    const quoted = Array.from(value.matchAll(/「([^」]+)」/g));
    if (quoted.length) value = quoted[quoted.length - 1][1];
    if (value.length <= 42) return value;
    const clipped = value.slice(0, 42);
    const boundary = clipped.lastIndexOf(' ');
    return (boundary >= 20 ? clipped.slice(0, boundary) : clipped) + '…';
  }

  function candidate(text, kind, style) {
    return { text, kind, style, demo: true, sourceOrigin: 'ai' };
  }

  function poolFor(text, action) {
    const value = short(text);
    if (action === 'project') return [
      candidate('如果「' + value + '」成立，接下来会出现什么可观察结果？', 'question', 'concrete'),
      candidate('「' + value + '」之后，哪一个结果最值得先验证？', 'question', 'concrete'),
      candidate('为「' + value + '」安排一个最小的后续动作。', 'direction', 'concrete'),
      candidate('「' + value + '」的后续影响最值得观察哪一个指标？', 'question', 'concrete'),
      candidate('如果「' + value + '」改变一个条件，结果会怎么变？', 'premise', 'abstract'),
      candidate('「' + value + '」可能打开哪一条此前没有的路径？', 'idea', 'abstract'),
    ];
    if (action === 'decompose') return [
      candidate('「' + value + '」可以拆成哪几个更小的问题？', 'question', 'abstract'),
      candidate('先写下「' + value + '」最小的一步是什么。', 'direction', 'concrete'),
      candidate('「' + value + '」还需要明确哪一个前提？', 'premise', 'abstract'),
      candidate('「' + value + '」由哪些对象或关系组成？', 'concept', 'abstract'),
      candidate('要理解「' + value + '」，还缺哪一块具体信息？', 'question', 'concrete'),
      candidate('「' + value + '」的先后顺序可以怎样安排？', 'direction', 'concrete'),
    ];
    if (action === 'alternatives') return [
      candidate('如果不采用「' + value + '」，还有什么不同路径？', 'idea', 'abstract'),
      candidate('「' + value + '」的相反选择会带来什么？', 'question', 'abstract'),
      candidate('保留「' + value + '」的哪一部分，同时改变其余部分？', 'idea', 'concrete'),
      candidate('改变「' + value + '」的一个条件，会不会出现新方案？', 'premise', 'abstract'),
      candidate('「' + value + '」能否换成相反方向的尝试？', 'idea', 'abstract'),
      candidate('「' + value + '」之外，最小可行的另一种选择是什么？', 'idea', 'concrete'),
    ];
    if (action === 'trace') return [
      candidate('是什么具体情境让「' + value + '」出现？', 'question', 'concrete'),
      candidate('「' + value + '」目前有哪些原话或事实依据？', 'evidence', 'concrete'),
      candidate('「' + value + '」默认了什么尚未说出的前提？', 'premise', 'abstract'),
      candidate('「' + value + '」与此前哪一个版本最相近？', 'question', 'concrete'),
      candidate('「' + value + '」形成过程中，哪一步发生了转折？', 'evidence', 'concrete'),
      candidate('关于「' + value + '」，还有哪条原话尚未被重新查看？', 'evidence', 'concrete'),
    ];
    if (action === 'challenge') return [
      candidate('什么情况下「' + value + '」不成立？', 'premise', 'abstract'),
      candidate('什么证据会让我修改「' + value + '」？', 'evidence', 'concrete'),
      candidate('「' + value + '」有没有一个反例？', 'question', 'abstract'),
      candidate('「' + value + '」最强的反对理由可能是什么？', 'question', 'abstract'),
      candidate('「' + value + '」只在什么范围内成立？', 'premise', 'abstract'),
      candidate('「' + value + '」目前最缺哪一种验证？', 'evidence', 'concrete'),
    ];
    return [];
  }

  function similarity(first, second) {
    const a = new Set(first);
    const b = new Set(second);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((token) => { if (b.has(token)) shared++; });
    return shared / (a.size + b.size - shared);
  }

  function expand(input) {
    const node = input && input.node;
    const action = input && input.action;
    if (!node || !String(node.text || '').trim()) throw new Error('缺少要扩展的节点。');
    const kind = graph.classifyThought(node.text, { kind: node.kind });
    if (!graph.allowedActions(kind).some((item) => item.id === action)) {
      return { candidates: [], reason: kind === 'fragment' ? '片段默认不由 AI 补全，请先回到原话。' : '这类节点暂不支持该扩展方式。' };
    }
    const prefs = preferences.createPreferences(input.preferences);
    const exploration = keywords.createFocusPreferences({ exploration: input.exploration }).exploration;
    if (Number(input.count) === 0) return { candidates: [], reason: 'B=0：思维扩展已暂停，现有网络不会改变。' };
    const existingCandidates = (input.existingCandidates || []).map((item) => typeof item === 'string' ? { text: item } : item);
    const pool = poolFor(node.text, action).map((item) => Object.assign({}, item, { action }));
    const deduped = guard.dedupeCandidates({ nodes: existingCandidates }, pool);
    const count = [0, 1, 2, 3].includes(Number(input.count)) ? Number(input.count) : prefs.count;
    const ranked = preferences.rankCandidates(deduped.kept, prefs).map((item) => Object.assign({}, item, {
      id: item.text,
      relevance: item.preferenceScore / 100,
      tokens: keywords.tokenize(item.text),
    }));
    const candidates = keywords.selectWithMMR(ranked, exploration, (a, b) => similarity(a.tokens, b.tokens), count)
      .map((item) => {
        const clean = Object.assign({}, item, {
          demo: true,
          sourceOrigin: 'ai',
          exploration,
          duplicateCount: deduped.duplicates.length,
        });
        delete clean.relevance;
        delete clean.tokens;
        return clean;
      });
    return {
      candidates,
      reason: candidates.length ? null : '这条路径已有相同或高度相近的候选，不再重复生成。',
      skippedDuplicates: deduped.duplicates,
      notice: '本地规则演示：只生成结构化思考提示，不是真实 AI 语义扩展。候选可接受、修改或拒绝。',
    };
  }

  return { expand };
});
