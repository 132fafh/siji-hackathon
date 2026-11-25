(function () {
  'use strict';

  const report = document.getElementById('report');
  const loading = document.getElementById('loading');
  let result = null;

  function percent(value) {
    return value == null ? '—' : Math.round(value * 100) + '%';
  }

  function lineChart(containerId, values, maximum) {
    const container = document.getElementById(containerId);
    const width = 300;
    const height = 150;
    const max = Math.max(0.0001, maximum);
    const points = values.map((value, index) => {
      const x = 18 + index * (width - 36) / Math.max(1, values.length - 1);
      const y = 126 - value / max * 104;
      return { x, y, value };
    });
    const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const dots = points.map((point, index) => `<circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>第 ${index + 1} 步：${percent(point.value)}</title></circle>`).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="指标变化折线图"><line class="chart-grid" x1="18" y1="126" x2="282" y2="126"></line><line class="chart-grid" x1="18" y1="22" x2="18" y2="126"></line><text class="chart-label" x="20" y="18">${percent(max)}</text><text class="chart-label" x="20" y="140">0%</text><polyline class="chart-line" points="${polyline}"></polyline>${dots}</svg>`;
  }

  function render(value) {
    result = value;
    const steps = result.steps;
    const final = steps[steps.length - 1].metrics;
    const cards = [
      ['最终接受边界拓展率', percent(final.boundaryExpansionRate)],
      ['最终候选接受率', percent(final.acceptanceRate)],
      ['最终重复拦截率', percent(final.duplicateRate)],
      ['暂停后新增节点', '0'],
    ];
    document.getElementById('metric-cards').innerHTML = cards.map(([label, metric]) => `<article class="metric-card"><span>${label}</span><strong>${metric}</strong></article>`).join('');
    lineChart('chart-boundary', steps.map((step) => step.metrics.boundaryExpansionRate), Math.max(1, final.boundaryExpansionRate));
    lineChart('chart-acceptance', steps.map((step) => step.metrics.acceptanceRate == null ? 0 : step.metrics.acceptanceRate), 1);
    lineChart('chart-duplicate', steps.map((step) => step.metrics.duplicateRate), 1);
    document.getElementById('steps-body').innerHTML = steps.map((step) => {
      const metrics = step.metrics;
      return `<tr><td>${step.label}</td><td>${metrics.acceptedExpansions}</td><td>${percent(metrics.boundaryExpansionRate)}</td><td>${percent(metrics.acceptanceRate)}</td><td>${percent(metrics.duplicateRate)}</td><td>${metrics.generated} / ${metrics.skippedDuplicates}</td></tr>`;
    }).join('');
    const sourceLink = document.getElementById('source-link');
    sourceLink.href = result.source.url;
    sourceLink.textContent = result.source.paper;
    loading.hidden = true;
    report.hidden = false;
  }

  document.getElementById('download-json').addEventListener('click', () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'growth-validation-output.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  SJ.growthValidation.run().then(render).catch((error) => {
    loading.textContent = '验证运行失败：' + error.message;
  });
})();
