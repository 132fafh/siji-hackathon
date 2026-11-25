(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SijiTriggerEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    threshold: 60,
    mode: 'standard',
    enabled: true,
    demoMode: true,
    cooldownMs: 90000
  });

  const MODE_MULTIPLIERS = Object.freeze({
    low: 0.75,
    standard: 1,
    high: 1.25,
    off: 1
  });

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeSettings(settings) {
    const input = settings && typeof settings === 'object' ? settings : {};
    const mode = Object.prototype.hasOwnProperty.call(MODE_MULTIPLIERS, input.mode)
      ? input.mode
      : DEFAULT_SETTINGS.mode;
    return {
      threshold: clamp(finiteNumber(input.threshold, DEFAULT_SETTINGS.threshold), 0, 100),
      mode,
      enabled: input.enabled !== false && mode !== 'off',
      demoMode: input.demoMode !== false,
      cooldownMs: clamp(
        finiteNumber(input.cooldownMs, DEFAULT_SETTINGS.cooldownMs),
        0,
        24 * 60 * 60 * 1000
      )
    };
  }

  function normalizeFeatures(features) {
    const input = features && typeof features === 'object' ? features : {};
    return {
      pauseMs: clamp(finiteNumber(input.pauseMs, 0), 0, 60 * 60 * 1000),
      backspaceRate: clamp(finiteNumber(input.backspaceRate, 0), 0, 1),
      rewriteCount: Math.round(clamp(finiteNumber(input.rewriteCount, 0), 0, 1000)),
      rereadCount: Math.round(clamp(finiteNumber(input.rereadCount, 0), 0, 1000)),
      unfinishedSentence: input.unfinishedSentence === true,
      longAnswerUncontinued: input.longAnswerUncontinued === true,
      unresolvedReference: input.unresolvedReference === true,
      draftLength: Math.round(clamp(finiteNumber(input.draftLength, 0), 0, 1000000))
    };
  }

  function computeScore(features, settings) {
    const snapshot = normalizeFeatures(features);
    const config = normalizeSettings(settings);
    const multiplier = MODE_MULTIPLIERS[config.mode];
    const rules = [];

    if (snapshot.pauseMs >= 1500) {
      const pausePoints = config.demoMode
        ? Math.min(42, snapshot.pauseMs / 10000 * 42)
        : Math.min(32, snapshot.pauseMs / 30000 * 32);
      rules.push({
        code: 'pause',
        points: pausePoints,
        text: '输入停顿变长，当前思路可能需要重新组织'
      });
    }

    if (snapshot.backspaceRate > 0.12) {
      rules.push({
        code: 'backspace',
        points: Math.min(12, (snapshot.backspaceRate - 0.12) * 30),
        text: '退格操作占比较高，草稿可能仍在反复调整'
      });
    }

    if (snapshot.rewriteCount > 0) {
      rules.push({
        code: 'rewrite',
        points: Math.min(12, snapshot.rewriteCount * 4),
        text: '检测到较大幅度的草稿重写'
      });
    }

    if (snapshot.rereadCount > 0) {
      rules.push({
        code: 'reread',
        points: Math.min(10, snapshot.rereadCount * 3),
        text: '检测到向上回读历史内容的行为'
      });
    }

    if (snapshot.unfinishedSentence && snapshot.draftLength >= 4) {
      rules.push({
        code: 'unfinished',
        points: 9,
        text: '当前草稿较长且尚未出现句末标点'
      });
    }

    if (snapshot.longAnswerUncontinued) {
      rules.push({
        code: 'long-answer',
        points: 14,
        text: '长回答之后暂未检测到新的用户续写'
      });
    }

    if (snapshot.unresolvedReference) {
      rules.push({
        code: 'reference',
        points: 8,
        text: '短草稿中含有指代表达，本地上下文可能不够明确'
      });
    }

    if (snapshot.draftLength > 240) {
      rules.push({
        code: 'draft-length',
        points: Math.min(10, (snapshot.draftLength - 240) / 60),
        text: '当前草稿较长，重组上下文的成本可能上升'
      });
    }

    const reasons = rules
      .map(function (rule) {
        return {
          code: rule.code,
          points: Math.round(rule.points * multiplier * 10) / 10,
          text: rule.text
        };
      })
      .filter(function (rule) { return rule.points > 0; })
      .sort(function (a, b) { return b.points - a.points; });

    const totalPoints = reasons.reduce(function (sum, rule) {
      return sum + rule.points;
    }, 0);

    return {
      score: Math.round(clamp(100 - totalPoints, 0, 100)),
      reasons,
      featureSnapshot: snapshot
    };
  }

  function isInCooldown(now, lastTriggeredAt, cooldownMs) {
    const current = finiteNumber(now, 0);
    const previous = finiteNumber(lastTriggeredAt, NaN);
    if (!Number.isFinite(previous)) {
      return false;
    }
    const duration = clamp(
      finiteNumber(cooldownMs, DEFAULT_SETTINGS.cooldownMs),
      0,
      24 * 60 * 60 * 1000
    );
    const elapsed = current - previous;
    return elapsed >= 0 && elapsed < duration;
  }

  function shouldTrigger(score, now, lastTriggeredAt, settings) {
    const config = normalizeSettings(settings);
    if (!config.enabled || !Number.isFinite(Number(score))) {
      return false;
    }
    if (isInCooldown(now, lastTriggeredAt, config.cooldownMs)) {
      return false;
    }
    return Number(score) <= config.threshold;
  }

  function getDefaultSettings() {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  return {
    DEFAULT_SETTINGS,
    computeScore,
    shouldTrigger,
    isInCooldown,
    normalizeFeatures,
    normalizeSettings,
    getDefaultSettings
  };
});
