(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = isNode ? factory(require('./graph-expansion-guard.js')) : factory(root.SJ.graphExpansionGuard);
  if (isNode) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.thoughtGraph = api;
})(typeof window !== 'undefined' ? window : globalThis, function (expansionGuard) {
  'use strict';

  const KINDS = {
    concept: { label: '概念', description: '正在讨论的对象或术语' },
    idea: { label: '想法', description: '主张、方案或观点' },
    question: { label: '疑问', description: '问题、未知或待确认内容' },
    evidence: { label: '依据', description: '理由、证据或具体经历' },
    premise: { label: '前提与边界', description: '假设、条件、限制或反例' },
    direction: { label: '方向', description: '目标、下一步或行动' },
    conclusion: { label: '结论', description: '暂定结论、决定或确认版本' },
    fragment: { label: '片段', description: '尚未成形的原话片段' },
  };

  const ACTIONS = {
    project: { label: '向后推演', relation: '推演', description: '如果成立，接下来可能出现什么' },
    decompose: { label: '向下细化', relation: '细化', description: '拆成子问题、步骤或组成部分' },
    alternatives: { label: '横向扩展', relation: '候选', description: '寻找不同路径或替代方案' },
    trace: { label: '向前追因', relation: '溯源', description: '寻找来源、前提和形成过程' },
    challenge: { label: '反向检查', relation: '检验', description: '寻找反例、边界和缺失证据' },
  };

  const ALLOWED_ACTIONS = {
    concept: ['decompose', 'alternatives', 'trace'],
    idea: ['project', 'decompose', 'alternatives', 'trace', 'challenge'],
    question: ['decompose', 'trace', 'challenge'],
    evidence: ['trace', 'challenge'],
    premise: ['project', 'trace', 'challenge'],
    direction: ['project', 'decompose', 'challenge'],
    conclusion: ['project', 'trace', 'challenge'],
    fragment: [],
  };

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength || 500);
  }

  function classifyThought(text, context) {
    const opts = context || {};
    if (opts.kind && KINDS[opts.kind]) return opts.kind;
    const value = cleanText(text).toLocaleLowerCase();
    if (!value) return 'fragment';
    if (opts.final || opts.role === 'Conclusion') return 'conclusion';
    if (/说不出|说不清|还没想好|没有成形|脑子空白|\bunclear\b|\bunformed\b/i.test(value)) return 'fragment';
    if (/如果|若|除非|只要|只有|前提|限制|边界|不成立|反例|\bif\b|\bunless\b|\bassumption\b/i.test(value)) return 'premise';
    if (/[?？]|为什么|如何|是否|能不能|怎么|怎样|不知道|未知|\bwhy\b|\bwhat\b|\bwhich\b|\bunknown\b|\bdo not know\b|\bdon't know\b/i.test(value)) return 'question';
    if (/因为|证据|数据|实验|上次|经历|研究发现|理由是|\bbecause\b|\bevidence\b|\breason\b|\bdata\b/i.test(value)) return 'evidence';
    if (/结论|决定|确认|最终|暂定|就这样|共同选择|\bso\b|\bfinal\b|\bconclusion\b|\bdecided\b/i.test(value)) return 'conclusion';
    if (/下一步|目标|希望|想要|打算|行动|先做|再做|\bnext\b|\bgoal\b|\bplan\b/i.test(value)) return 'direction';
    if (/我想|我认为|可以|方案|应该|建议|选择|检查|翻|\bi think\b|\bshould\b|\bcould\b|\bgoing with\b|\bway to go\b/i.test(value)) return 'idea';
    if (opts.role === 'Reasoning') return 'evidence';
    if (opts.role === 'Solution') return 'idea';
    return 'concept';
  }

  function allowedActions(kind) {
    return (ALLOWED_ACTIONS[kind] || ALLOWED_ACTIONS.concept).map((id) => Object.assign({ id }, ACTIONS[id]));
  }

  function sourceMessage(text, messages) {
    const needle = cleanText(text).toLocaleLowerCase();
    if (!needle) return '';
    const match = (messages || []).find((item) => {
      const value = typeof item === 'string' ? item : item && item.text;
      return cleanText(value, 20000).toLocaleLowerCase().includes(needle);
    });
    return typeof match === 'string' ? match : match && match.text ? match.text : '';
  }

  function makeNode(id, text, options) {
    const opts = options || {};
    return {
      id,
      text: cleanText(text, 160),
      fullText: cleanText(opts.fullText || text, 1000),
      kind: classifyThought(text, opts),
      sourceOrigin: opts.sourceOrigin || 'human',
      sourceTurnId: opts.sourceTurnId || null,
      sourceQuote: cleanText(opts.sourceQuote, 20000),
      labelOrigin: opts.labelOrigin || 'extractive',
      status: opts.status || 'active',
      depth: Number.isFinite(opts.depth) ? opts.depth : 1,
      parentId: opts.parentId || null,
      action: opts.action || null,
      style: opts.style === 'abstract' ? 'abstract' : 'concrete',
      demo: Boolean(opts.demo),
      preferenceScore: Number.isFinite(opts.preferenceScore) ? opts.preferenceScore : null,
      createdAt: opts.createdAt || Date.now(),
    };
  }

  function createGraphFromBubble(bubble, context) {
    const opts = context || {};
    const messages = opts.messages || [];
    const sourceOrigin = opts.session && opts.session.demoPublicCase ? 'public' : opts.session ? 'human' : 'demo';
    const sourceQuote = cleanText(bubble.sourceQuote || sourceMessage(bubble.text, messages), 20000);
    const central = makeNode(bubble.id, bubble.text, {
      kind: bubble.kind,
      fullText: bubble.note ? bubble.text + '\n' + bubble.note : bubble.text,
      sourceOrigin,
      sourceQuote,
      labelOrigin: bubble.edited ? 'user_edit' : 'extractive',
      depth: 1,
    });
    const graph = { version: 1, rootId: central.id, nodes: [central], edges: [], nextSerial: 1 };
    if (sourceQuote && sourceQuote.toLocaleLowerCase() !== central.text.toLocaleLowerCase()) {
      const source = makeNode(central.id + '__source', '原始表达', {
        kind: 'evidence',
        fullText: sourceQuote,
        sourceOrigin,
        sourceQuote,
        labelOrigin: 'source_label',
        depth: 0,
      });
      graph.nodes.push(source);
      graph.edges.push({ id: source.id + '-to-' + central.id, from: source.id, to: central.id, type: 'source', status: 'active', sourceOrigin });
    }
    const centralText = central.text.toLocaleLowerCase();
    const relatedMessages = messages.map((message) => typeof message === 'string' ? message : message.text).filter((message) => message && message.toLocaleLowerCase().includes(centralText));
    (opts.bubbles || []).filter((bubble) => bubble.id !== central.id).forEach((bubble) => {
      if (graph.nodes.length >= 6) return;
      const text = cleanText(bubble.text, 160);
      if (!text || !relatedMessages.some((message) => message.toLocaleLowerCase().includes(text.toLocaleLowerCase()))) return;
      const quote = sourceMessage(text, relatedMessages);
      const related = makeNode(bubble.id, text, {
        kind: bubble.kind,
        sourceOrigin,
        sourceQuote: quote,
        labelOrigin: bubble.edited ? 'user_edit' : 'extractive',
        depth: 2,
      });
      graph.nodes.push(related);
      graph.edges.push({ id: central.id + '-to-' + related.id, from: central.id, to: related.id, type: 'cooccurrence', status: 'active', sourceOrigin });
    });
    return graph;
  }

  function cloneGraph(graph) {
    return Object.assign({}, graph, {
      nodes: (graph.nodes || []).map((node) => Object.assign({}, node)),
      edges: (graph.edges || []).map((edge) => Object.assign({}, edge)),
    });
  }

  function addExpansion(graph, parentId, action, candidates, meta) {
    const parent = graph.nodes.find((node) => node.id === parentId);
    if (!parent) throw new Error('找不到要扩展的节点。');
    if (!ACTIONS[action] || !allowedActions(parent.kind).some((item) => item.id === action)) {
      throw new Error('这类节点暂不支持该扩展方式。');
    }
    const options = meta || {};
    const next = cloneGraph(graph);
    const addedIds = [];
    const deduped = expansionGuard.dedupeCandidates(next, (candidates || []).slice(0, 12));
    deduped.kept.slice(0, 3).forEach((candidate) => {
      const text = cleanText(candidate && candidate.text, 160);
      if (!text) return;
      const id = 'ai-' + Number(options.timestamp || Date.now()).toString(36) + '-' + next.nextSerial++;
      const node = makeNode(id, text, {
        kind: candidate.kind || 'idea',
        sourceOrigin: 'ai',
        labelOrigin: options.actualMode === 'api' ? 'ai_api' : 'ai_demo',
        status: 'candidate',
        depth: parent.depth + 1,
        parentId,
        action,
        style: candidate.style,
        demo: options.actualMode !== 'api',
        preferenceScore: candidate.preferenceScore,
        createdAt: options.timestamp || Date.now(),
      });
      next.nodes.push(node);
      next.edges.push({
        id: parentId + '-to-' + id,
        from: parentId,
        to: id,
        type: action,
        status: 'candidate',
        sourceOrigin: 'ai',
      });
      addedIds.push(id);
    });
    next.expansionStats = Object.assign({ generated: 0, added: 0, skippedDuplicates: 0 }, next.expansionStats);
    next.expansionStats.generated += (candidates || []).length;
    next.expansionStats.added += addedIds.length;
    next.expansionStats.skippedDuplicates += deduped.duplicates.length;
    return {
      graph: next,
      addedIds,
      duplicates: deduped.duplicates,
      reason: deduped.duplicates.length && !addedIds.length ? '这条路径已有相同或高度相近的候选，没有重复添加。' : deduped.duplicates.length ? '已跳过 ' + deduped.duplicates.length + ' 条重复候选。' : null,
    };
  }

  function setCandidateStatus(graph, nodeId, status) {
    if (!['candidate', 'accepted', 'rejected'].includes(status)) return graph;
    const next = cloneGraph(graph);
    const node = next.nodes.find((item) => item.id === nodeId);
    if (!node || node.sourceOrigin !== 'ai') return graph;
    node.status = status;
    next.edges.forEach((edge) => {
      if (edge.to === nodeId) edge.status = status;
    });
    return next;
  }

  function editGraphNode(graph, nodeId, text) {
    const value = cleanText(text, 160);
    if (!value) return graph;
    const next = cloneGraph(graph);
    const node = next.nodes.find((item) => item.id === nodeId);
    if (!node || node.sourceOrigin !== 'ai') return graph;
    node.text = value;
    node.fullText = value;
    node.labelOrigin = 'user_edit';
    node.kind = classifyThought(value, { kind: node.kind });
    return next;
  }

  function layoutGraph(graph, options) {
    const opts = options || {};
    const includeRejected = Boolean(opts.includeRejected);
    const nodes = graph.nodes.filter((node) => includeRejected || node.status !== 'rejected');
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
    const columns = new Map();
    nodes.forEach((node) => {
      const depth = Math.max(0, Number(node.depth) || 0);
      if (!columns.has(depth)) columns.set(depth, []);
      columns.get(depth).push(node);
    });
    const positions = {};
    let maxRows = 1;
    let maxDepth = 0;
    columns.forEach((column, depth) => {
      maxRows = Math.max(maxRows, column.length);
      maxDepth = Math.max(maxDepth, depth);
      column.forEach((node, index) => {
        positions[node.id] = { x: 60 + depth * 280, y: 60 + index * 150, width: 190, height: 96 };
      });
    });
    return {
      positions,
      nodes,
      edges,
      width: Math.max(1050, maxDepth * 280 + 340),
      height: Math.max(620, maxRows * 150 + 100),
    };
  }

  return {
    KINDS,
    ACTIONS,
    ALLOWED_ACTIONS,
    classifyThought,
    allowedActions,
    sourceMessage,
    makeNode,
    createGraphFromBubble,
    addExpansion,
    setCandidateStatus,
    editGraphNode,
    layoutGraph,
  };
});
