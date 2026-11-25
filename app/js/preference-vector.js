(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.preferenceVector = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DIMENSIONS = {
    project: '向后推演',
    decompose: '向下细化',
    alternatives: '横向扩展',
    trace: '向前追因',
    challenge: '反向检查',
    concrete: '具体',
    abstract: '抽象',
  };

  function clampWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0.5;
    return Math.max(0.05, Math.min(0.95, number));
  }

  function defaults() {
    return {
      version: 2,
      weights: {
        project: 0.5,
        decompose: 0.5,
        alternatives: 0.5,
        trace: 0.5,
        challenge: 0.5,
        concrete: 0.5,
        abstract: 0.5,
      },
      style: 'balanced',
      count: 2,
      boundaryTarget: 5,
      history: [],
    };
  }

  function createPreferences(saved) {
    const base = defaults();
    const input = saved && !Array.isArray(saved) ? saved : {};
    Object.keys(base.weights).forEach((key) => {
      base.weights[key] = clampWeight(input.weights && input.weights[key]);
    });
    base.style = ['balanced', 'concrete', 'abstract'].includes(input.style) ? input.style : 'balanced';
    base.count = [0, 1, 2, 3].includes(Number(input.count)) ? Number(input.count) : 2;
    base.boundaryTarget = [1, 2, 3, 4, 5].includes(Number(input.boundaryTarget)) ? Number(input.boundaryTarget) : 5;
    base.history = Array.isArray(input.history) ? input.history.slice(-50).map((item) => ({
      action: DIMENSIONS[item.action] ? item.action : null,
      candidateId: String(item.candidateId || '').slice(0, 100),
      accepted: Boolean(item.accepted),
      ts: Number(item.ts) || 0,
    })).filter((item) => item.action) : [];
    return base;
  }

  function vectorFor(preferences) {
    const current = createPreferences(preferences);
    return Object.keys(DIMENSIONS).map((key) => current.weights[key]);
  }

  function updatePreference(preferences, key, value) {
    const next = createPreferences(preferences);
    if (Object.keys(next.weights).includes(key)) next.weights[key] = clampWeight(value);
    if (key === 'style' && ['balanced', 'concrete', 'abstract'].includes(value)) next.style = value;
    if (key === 'count' && [0, 1, 2, 3].includes(Number(value))) next.count = Number(value);
    if (key === 'boundaryTarget' && [1, 2, 3, 4, 5].includes(Number(value))) next.boundaryTarget = Number(value);
    return next;
  }

  function applyFeedback(preferences, candidate, accepted, timestamp) {
    const next = createPreferences(preferences);
    const action = candidate && candidate.action;
    if (!DIMENSIONS[action]) return next;
    const direction = accepted ? 1 : -1;
    next.weights[action] = clampWeight(next.weights[action] + direction * 0.12);
    const style = candidate && candidate.style;
    if (style === 'concrete' || style === 'abstract') {
      next.weights[style] = clampWeight(next.weights[style] + direction * 0.08);
      const other = style === 'concrete' ? 'abstract' : 'concrete';
      next.weights[other] = clampWeight(next.weights[other] - direction * 0.04);
    }
    next.history = next.history.concat([{
      action,
      candidateId: String(candidate.id || ''),
      accepted: Boolean(accepted),
      ts: timestamp || Date.now(),
    }]).slice(-50);
    return next;
  }

  function styleScore(candidate, preferences) {
    const style = candidate && candidate.style === 'abstract' ? 'abstract' : 'concrete';
    if (preferences.style === 'concrete' || preferences.style === 'abstract') {
      return preferences.style === style ? 1 : 0;
    }
    return preferences.weights[style];
  }

  function rankCandidates(candidates, preferences) {
    const current = createPreferences(preferences);
    return (candidates || []).map((candidate, index) => {
      const actionWeight = current.weights[candidate.action] == null ? 0.5 : current.weights[candidate.action];
      const score = actionWeight * 0.65 + styleScore(candidate, current) * 0.35;
      return Object.assign({}, candidate, { preferenceScore: Math.round(score * 100), _index: index });
    }).sort((a, b) => b.preferenceScore - a.preferenceScore || a._index - b._index).map((candidate) => {
      const clean = Object.assign({}, candidate);
      delete clean._index;
      return clean;
    });
  }

  function resetPreferences() {
    return defaults();
  }

  function preferenceSummary(preferences) {
    const current = createPreferences(preferences);
    const labels = Object.keys(ACTION_LABELS).sort((a, b) => current.weights[b] - current.weights[a]).slice(0, 2).map((key) => ACTION_LABELS[key]);
    const style = current.style === 'balanced' ? '具体与抽象均衡' : current.style === 'concrete' ? '偏具体' : '偏抽象';
    return labels.join('、') + ' · ' + style + ' · 每次 ' + current.count + ' 条 · 边界上限 ' + current.boundaryTarget * 100 + '%';
  }

  const ACTION_LABELS = {
    project: DIMENSIONS.project,
    decompose: DIMENSIONS.decompose,
    alternatives: DIMENSIONS.alternatives,
    trace: DIMENSIONS.trace,
    challenge: DIMENSIONS.challenge,
  };

  return {
    DIMENSIONS,
    createPreferences,
    vectorFor,
    updatePreference,
    applyFeedback,
    rankCandidates,
    resetPreferences,
    preferenceSummary,
  };
});
