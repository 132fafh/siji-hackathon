(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.graphKeywords = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STOPWORDS = new Set(('a an and are as at be because been but by can could do does for from had has have how i if in include is it its last least me my no not none of ok on one only or our so should some that the their them they this to very we what when which why with would you your good best right way things thing something someone next new really get make makes').split(' '));
  const CHINESE_STOPWORDS = new Set(['写下', '先写', '部分', '什么', '哪个', '哪些', '怎么', '怎样', '具体', '当前', '候选', '路径', '一个', '一些', '这样', '那样', '进行', '可以', '需要', '现在', '我们', '你们', '他们', '如果', '因为', '所以', '但是', '不是', '没有', '应该', '可能', '已经', '还是', '这个', '那个', '以下', '以上']);
  const EDGE_WEIGHTS = { source: 1, accepted: 1, project: 0.72, decompose: 0.72, alternatives: 0.5, trace: 0.72, challenge: 0.72, candidate: 0.42, cooccurrence: 0.22 };

  function clamp(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.35;
  }

  function createFocusPreferences(saved) {
    return { exploration: clamp(saved && saved.exploration) };
  }

  function tokenize(text) {
    const value = String(text || '').replace(/\b[A-Z][A-Za-z0-9_-]{1,24}:/g, ' ').replace(/[A-Za-z]{1,5}…/g, ' ').toLocaleLowerCase();
    const tokens = [];
    const english = value.match(/[a-z0-9]+/g) || [];
    english.forEach((token) => {
      if (token.length > 1 && !STOPWORDS.has(token)) tokens.push(token);
    });
    const chinese = value.match(/[一-龥]+/g) || [];
    chinese.forEach((part) => {
      if (part.length <= 2) {
        if (!/^[的了和是在我你他她它就不没有很太都也还]+/.test(part)) tokens.push(part);
        return;
      }
      for (let i = 0; i < part.length - 1; i++) tokens.push(part.slice(i, i + 2));
    });
    return tokens.filter((token) => !CHINESE_STOPWORDS.has(token));
  }

  function normalizeScores(scores) {
    const values = Object.values(scores);
    const max = values.length ? Math.max(...values) : 1;
    if (max <= 0) return scores;
    Object.keys(scores).forEach((key) => { scores[key] /= max; });
    return scores;
  }

  function buildTextGraph(nodes) {
    const documents = nodes.map((node) => ({
      id: node.id,
      tokens: tokenize(node.fullText || node.text),
      weight: node.sourceOrigin === 'ai' ? 0.2 : 1,
    }));
    const documentFrequency = {};
    const weights = {};
    documents.forEach((document) => {
      const unique = new Set(document.tokens);
      unique.forEach((token) => { documentFrequency[token] = (documentFrequency[token] || 0) + 1; });
      for (let i = 0; i < document.tokens.length; i++) {
        for (let j = i + 1; j < Math.min(document.tokens.length, i + 5); j++) {
          const a = document.tokens[i];
          const b = document.tokens[j];
          if (a === b) continue;
          const key = a < b ? a + '\u0000' + b : b + '\u0000' + a;
          weights[key] = (weights[key] || 0) + document.weight;
        }
      }
    });
    const adjacency = {};
    Object.entries(weights).forEach(([key, weight]) => {
      const [a, b] = key.split('\u0000');
      const idfA = Math.log((documents.length + 1) / (documentFrequency[a] + 1)) + 1;
      const idfB = Math.log((documents.length + 1) / (documentFrequency[b] + 1)) + 1;
      const weighted = weight * (idfA + idfB) / 2;
      if (!adjacency[a]) adjacency[a] = {};
      if (!adjacency[b]) adjacency[b] = {};
      adjacency[a][b] = (adjacency[a][b] || 0) + weighted;
      adjacency[b][a] = (adjacency[b][a] || 0) + weighted;
    });
    return { documents, documentFrequency, adjacency };
  }

  function textRank(nodes, options) {
    const opts = options || {};
    const damping = opts.damping == null ? 0.85 : opts.damping;
    const { documents, documentFrequency, adjacency } = buildTextGraph(nodes);
    const tokens = Object.keys(documentFrequency);
    let scores = {};
    tokens.forEach((token) => { scores[token] = 1 / Math.max(1, tokens.length); });
    const outgoingTotals = {};
    tokens.forEach((token) => {
      outgoingTotals[token] = Object.values(adjacency[token] || {}).reduce((sum, weight) => sum + weight, 0);
    });
    for (let iteration = 0; iteration < (opts.iterations || 35); iteration++) {
      const next = {};
      tokens.forEach((token) => {
        let score = 1 - damping;
        const neighbors = adjacency[token] || {};
        Object.entries(neighbors).forEach(([neighbor, weight]) => {
          if (outgoingTotals[neighbor]) score += damping * weight / outgoingTotals[neighbor] * scores[neighbor];
        });
        next[token] = score;
      });
      scores = next;
    }
    const visited = new Set();
    tokens.forEach((token) => {
      if (visited.has(token)) return;
      const component = [];
      const queue = [token];
      visited.add(token);
      while (queue.length) {
        const current = queue.shift();
        component.push(current);
        Object.keys(adjacency[current] || {}).forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
      const componentWeight = 0.5 + Math.log1p(component.length);
      component.forEach((member) => {
        scores[member] = Math.max(0.1, scores[member]) * componentWeight;
      });
    });
    normalizeScores(scores);
    return { scores, documents, documentFrequency, adjacency };
  }

  function edgeWeight(edge) {
    if (edge.status === 'rejected') return 0;
    if (edge.status === 'accepted') return 1;
    return EDGE_WEIGHTS[edge.type] == null ? 0.3 : EDGE_WEIGHTS[edge.type];
  }

  function personalizedPageRank(graph, focusId, options) {
    const opts = options || {};
    const damping = opts.damping == null ? 0.85 : opts.damping;
    const nodes = graph.nodes.filter((node) => node.status !== 'rejected');
    const ids = nodes.map((node) => node.id);
    const seedId = ids.includes(focusId) ? focusId : graph.rootId;
    const adjacency = {};
    ids.forEach((id) => { adjacency[id] = {}; });
    graph.edges.forEach((edge) => {
      if (!adjacency[edge.from] || !adjacency[edge.to]) return;
      const weight = edgeWeight(edge);
      if (!weight) return;
      adjacency[edge.from][edge.to] = (adjacency[edge.from][edge.to] || 0) + weight;
      adjacency[edge.to][edge.from] = (adjacency[edge.to][edge.from] || 0) + weight;
    });
    let scores = {};
    ids.forEach((id) => { scores[id] = id === seedId ? 1 : 0; });
    const outgoingTotals = {};
    ids.forEach((id) => {
      outgoingTotals[id] = Object.values(adjacency[id]).reduce((sum, weight) => sum + weight, 0);
    });
    for (let iteration = 0; iteration < (opts.iterations || 40); iteration++) {
      const next = {};
      ids.forEach((id) => {
        let score = id === seedId ? 1 - damping : 0;
        const neighbors = adjacency[id];
        Object.entries(neighbors).forEach(([neighbor, weight]) => {
          if (outgoingTotals[neighbor]) score += damping * weight / outgoingTotals[neighbor] * scores[neighbor];
        });
        next[id] = score;
      });
      scores = next;
    }
    return normalizeScores(scores);
  }

  function similarity(first, second) {
    const a = new Set(first);
    const b = new Set(second);
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((token) => { if (b.has(token)) shared++; });
    return shared / (a.size + b.size - shared);
  }

  function keywordSimilarity(first, second, documentSets) {
    if (first === second) return 1;
    if (first.includes(second) || second.includes(first)) return 0.85;
    return similarity(documentSets[first] || [], documentSets[second] || []);
  }

  function selectWithMMR(items, lambda, similarityFn, count) {
    const remaining = items.slice();
    const selected = [];
    const limit = count || 5;
    while (remaining.length && selected.length < limit) {
      remaining.sort((a, b) => {
        const similarityA = selected.length ? Math.max(...selected.map((item) => similarityFn(a, item))) : 0;
        const similarityB = selected.length ? Math.max(...selected.map((item) => similarityFn(b, item))) : 0;
        const scoreA = lambda * a.relevance - (1 - lambda) * similarityA;
        const scoreB = lambda * b.relevance - (1 - lambda) * similarityB;
        return scoreB - scoreA || b.relevance - a.relevance || a.id.localeCompare(b.id);
      });
      const next = remaining.shift();
      const redundancy = selected.length ? Math.max(...selected.map((item) => similarityFn(next, item))) : 0;
      selected.push(Object.assign({}, next, {
        redundancy,
        mmrScore: lambda * next.relevance - (1 - lambda) * redundancy,
      }));
    }
    return selected;
  }

  function focusPath(graph, focusId) {
    const path = [];
    const visited = new Set();
    let current = graph.nodes.find((node) => node.id === focusId) || graph.nodes.find((node) => node.id === graph.rootId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.id);
      current = current.parentId ? graph.nodes.find((node) => node.id === current.parentId) : null;
    }
    if (path.length) {
      const rootId = path[0];
      const source = graph.edges.find((edge) => edge.to === rootId && edge.type === 'source' && edge.status !== 'rejected');
      if (source) path.unshift(source.from);
    }
    return path;
  }

  function computeGraphKeywords(graph, options) {
    const opts = options || {};
    const focusId = opts.focusId || graph.rootId;
    const preferences = createFocusPreferences({ exploration: opts.exploration });
    const lambda = preferences.exploration;
    const nodes = graph.nodes.filter((node) => node.status !== 'rejected');
    const text = textRank(nodes, opts);
    const centrality = personalizedPageRank(graph, focusId, opts);
    const focusNode = nodes.find((node) => node.id === focusId) || nodes[0];
    const focusTokens = tokenize(focusNode && (focusNode.fullText || focusNode.text));
    const nodeItems = nodes.map((node) => {
      const tokens = tokenize(node.fullText || node.text);
      const textScores = tokens.map((token) => text.scores[token] || 0);
      const textImportance = textScores.length ? textScores.reduce((sum, score) => sum + score, 0) / textScores.length : 0;
      const focusSimilarity = similarity(tokens, focusTokens);
      const relevance = 0.45 * textImportance + 0.35 * (centrality[node.id] || 0) + 0.2 * focusSimilarity;
      return { id: node.id, text: node.text, relevance, textImportance, centrality: centrality[node.id] || 0, focusSimilarity, tokens };
    });
    const rankedNodes = selectWithMMR(nodeItems, lambda, (a, b) => similarity(a.tokens, b.tokens), nodes.length);
    const documentSets = {};
    text.documents.forEach((document) => { document.tokens.forEach((token) => { (documentSets[token] = documentSets[token] || []).push(document.id); }); });
    const keywordItems = Object.keys(text.scores).map((token) => ({
      id: token,
      text: token,
      relevance: text.scores[token],
      documents: documentSets[token],
    })).filter((item) => item.relevance > 0);
    const keywords = selectWithMMR(keywordItems, lambda, (a, b) => keywordSimilarity(a.id, b.id, documentSets), opts.count || 5);
    return {
      lambda,
      keywords,
      nodes: rankedNodes,
      centrality,
      path: focusPath(graph, focusId),
      model: 'textrank-personalized-pagerank-mmr',
    };
  }

  return {
    createFocusPreferences,
    tokenize,
    textRank,
    personalizedPageRank,
    selectWithMMR,
    focusPath,
    computeGraphKeywords,
    edgeWeight,
  };
});
