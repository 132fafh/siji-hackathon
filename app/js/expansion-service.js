(function () {
  'use strict';

  const SJ = (window.SJ = window.SJ || {});

  async function expand(input) {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 20000);
        const response = await fetch('/api/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        const value = await response.json();
        if (!response.ok || !Array.isArray(value.candidates)) throw new Error('扩展服务暂时不可用');
        return value;
      } catch (error) {
        return Object.assign(SJ.demoExpansion.expand(input), {
          meta: { actualMode: 'demo', fallback: true, reason: '后端不可用，已使用本地规则演示。' },
        });
      }
    }
    return Object.assign(SJ.demoExpansion.expand(input), {
      meta: { actualMode: 'demo', fallback: false, reason: null },
    });
  }

  SJ.expansionService = { expand };
})();
