(function () {
  'use strict';

  if (window.SijiPopup) {
    return;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let overlay;
  let dialog;
  let scoreValue;
  let reasonList;
  let chart;
  let status;
  let enterButton;
  let details;
  let sensitivityInput;
  let sensitivityValue;
  let thresholdInput;
  let previousFocus = null;
  let currentSettings = null;
  let currentHandlers = {};
  let isOpen = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function svgElement(tag, attributes) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, String(attributes[name]));
    });
    return node;
  }

  function build() {
    overlay = element('div', 'siji-overlay');
    overlay.id = 'siji-context-overlay';
    overlay.hidden = true;

    dialog = element('section', 'siji-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'siji-dialog-title');
    dialog.tabIndex = -1;

    const header = element('header', 'siji-header');
    const title = element('h2', 'siji-title', '需要整理一下当前思路吗？');
    title.id = 'siji-dialog-title';
    const closeButton = element('button', 'siji-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭提醒');
    closeButton.addEventListener('click', function () { close('dismiss'); });
    header.append(title, closeButton);

    const body = element('div', 'siji-body');
    const scoreRow = element('div', 'siji-score-row');
    const scoreGroup = element('div', 'siji-score-group');
    scoreValue = element('strong', 'siji-score', '100');
    scoreGroup.append(scoreValue, element('span', 'siji-score-total', ' / 100'));
    scoreRow.append(element('span', 'siji-score-caption', '演示评分'), scoreGroup);

    details = element('details', 'siji-details');
    details.append(element('summary', 'siji-details-summary', '详情'));
    const detailsBody = element('div', 'siji-details-body');

    const reasonsSection = element('section', 'siji-reasons');
    reasonsSection.append(element('h3', 'siji-section-title', '评分原因'));
    reasonList = element('ul', 'siji-reason-list');
    reasonsSection.append(reasonList);

    const chartFrame = element('div', 'siji-chart-frame');
    chart = svgElement('svg', {
      class: 'siji-chart',
      viewBox: '0 0 520 132',
      role: 'img',
      'aria-label': '最近上下文融合演示评分曲线',
      preserveAspectRatio: 'none'
    });
    chartFrame.append(chart);

    const settings = element('div', 'siji-settings');
    const settingsGrid = element('div', 'siji-settings-grid');
    const sensitivityLabel = element('label', 'siji-field');
    const sensitivityCaption = element('span', 'siji-field-label', '灵敏度');
    sensitivityInput = element('input', 'siji-range');
    sensitivityInput.type = 'range';
    sensitivityInput.min = '0';
    sensitivityInput.max = '2';
    sensitivityInput.step = '1';
    sensitivityInput.setAttribute('aria-label', '提醒灵敏度');
    sensitivityValue = element('output', 'siji-sensitivity-value', '标准');
    sensitivityCaption.append(sensitivityValue);
    sensitivityLabel.append(sensitivityCaption, sensitivityInput);

    const thresholdLabel = element('label', 'siji-field');
    thresholdLabel.append(element('span', 'siji-field-label', '触发阈值（0–100）'));
    thresholdInput = element('input', 'siji-input');
    thresholdInput.type = 'number';
    thresholdInput.min = '0';
    thresholdInput.max = '100';
    thresholdInput.step = '1';
    thresholdLabel.append(thresholdInput);
    settingsGrid.append(sensitivityLabel, thresholdLabel);
    settings.append(
      settingsGrid,
      element('p', 'siji-settings-note', '分数小于等于阈值时提醒；连续提醒有冷却时间。')
    );
    sensitivityInput.addEventListener('input', saveSettings);
    thresholdInput.addEventListener('change', saveSettings);

    const suppressButton = element('button', 'siji-button siji-button-muted', '本次别提醒');
    suppressButton.type = 'button';
    suppressButton.addEventListener('click', function () { close('suppress'); });
    detailsBody.append(reasonsSection, chartFrame, settings, suppressButton);
    details.append(detailsBody);

    status = element('p', 'siji-status');
    status.setAttribute('role', 'alert');
    status.hidden = true;
    body.append(
      element('p', 'siji-boundary', '思迹可以整理当前草稿；评分仅为本地演示，不是真实遗忘概率。'),
      scoreRow,
      details,
      status
    );

    const footer = element('footer', 'siji-footer');
    const dismissButton = element('button', 'siji-button', '不用，我还好');
    dismissButton.type = 'button';
    dismissButton.addEventListener('click', function () { close('dismiss'); });
    enterButton = element('button', 'siji-button siji-button-primary', '批准');
    enterButton.type = 'button';
    enterButton.setAttribute('aria-label', '批准并进入思迹');
    enterButton.addEventListener('click', enterSiji);
    footer.append(dismissButton, enterButton);

    dialog.append(header, body, footer);
    overlay.append(dialog);
    document.documentElement.append(overlay);
    document.addEventListener('keydown', handleKeydown, true);
  }

  function saveSettings() {
    if (!currentSettings) {
      return;
    }
    const modes = ['low', 'standard', 'high'];
    const labels = ['少打扰', '标准', '较灵敏'];
    const sensitivity = Math.max(0, Math.min(2, Number(sensitivityInput.value) || 0));
    const threshold = Math.min(100, Math.max(0, Number(thresholdInput.value) || 0));
    currentSettings = Object.assign({}, currentSettings, {
      mode: modes[sensitivity],
      enabled: true,
      threshold
    });
    sensitivityValue.textContent = labels[sensitivity];
    thresholdInput.value = String(threshold);
    chrome.storage.local.set({ sijiSettings: currentSettings }, function () {
      window.dispatchEvent(new CustomEvent('siji-settings-changed', {
        detail: Object.assign({}, currentSettings)
      }));
    });
  }

  function renderReasons(reasons) {
    reasonList.replaceChildren();
    const items = Array.isArray(reasons) && reasons.length
      ? reasons.slice(0, 4)
      : [{ text: '当前没有单项明显特征，评分来自多项轻微信号', points: 0 }];
    items.forEach(function (reason) {
      const item = element('li', 'siji-reason-item');
      item.append(element('span', 'siji-reason-text', reason.text));
      if (reason.points) {
        item.append(element('span', 'siji-reason-points', `−${reason.points} 分`));
      }
      reasonList.append(item);
    });
  }

  function renderChart(history, threshold) {
    chart.replaceChildren();
    const width = 520;
    const height = 132;
    const padding = { left: 30, right: 10, top: 10, bottom: 20 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const samples = (Array.isArray(history) ? history : []).slice(-40);

    [0, 50, 100].forEach(function (value) {
      const y = padding.top + (100 - value) / 100 * plotHeight;
      chart.append(svgElement('line', {
        x1: padding.left, y1: y, x2: width - padding.right, y2: y,
        class: 'siji-chart-grid'
      }));
      const label = svgElement('text', { x: 2, y: y + 4, class: 'siji-chart-label' });
      label.textContent = String(value);
      chart.append(label);
    });

    const thresholdY = padding.top + (100 - threshold) / 100 * plotHeight;
    chart.append(svgElement('line', {
      x1: padding.left, y1: thresholdY, x2: width - padding.right, y2: thresholdY,
      class: 'siji-chart-threshold'
    }));

    if (!samples.length) {
      return;
    }
    const points = samples.map(function (sample, index) {
      const value = typeof sample === 'number' ? sample : sample.score;
      const x = samples.length === 1
        ? padding.left
        : padding.left + index / (samples.length - 1) * plotWidth;
      const y = padding.top + (100 - Math.max(0, Math.min(100, value))) / 100 * plotHeight;
      return `${x},${y}`;
    }).join(' ');
    chart.append(svgElement('polyline', { points, class: 'siji-chart-line' }));
  }

  function show(result, options) {
    if (!overlay) {
      build();
    }
    const modes = ['low', 'standard', 'high'];
    const labels = ['少打扰', '标准', '较灵敏'];
    currentHandlers = options || {};
    currentSettings = Object.assign({}, result.settings || {});
    previousFocus = document.activeElement;
    isOpen = true;
    scoreValue.textContent = String(result.score);
    const sensitivity = Math.max(0, modes.indexOf(currentSettings.mode));
    sensitivityInput.value = String(sensitivity);
    sensitivityValue.textContent = labels[sensitivity];
    thresholdInput.value = String(currentSettings.threshold);
    details.open = false;
    status.hidden = true;
    status.textContent = '';
    enterButton.disabled = false;
    enterButton.textContent = '批准';
    renderReasons(result.reasons);
    renderChart(result.history, currentSettings.threshold);
    overlay.hidden = false;
    requestAnimationFrame(function () {
      enterButton.focus({ preventScroll: true });
    });
  }

  function close(action) {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    overlay.hidden = true;
    const callback = typeof currentHandlers.onClose === 'function'
      ? currentHandlers.onClose
      : function () {};
    callback(action || 'dismiss');
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch (_) {
        previousFocus.focus();
      }
    }
    previousFocus = null;
  }

  function enterSiji() {
    if (!currentHandlers.getHandoff) {
      showStatus('暂时无法取得当前草稿，请刷新页面后重试。');
      return;
    }
    enterButton.disabled = true;
    enterButton.textContent = '正在交接…';
    status.hidden = true;
    const payload = currentHandlers.getHandoff();
    chrome.runtime.sendMessage({ type: 'enterSiji', payload }, function (response) {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response || !response.ok) {
        enterButton.disabled = false;
        enterButton.textContent = '批准';
        showStatus(runtimeError
          ? '无法连接插件后台，请确认扩展已启用后重试。'
          : response && response.error ? response.error : '交接失败，请稍后重试。');
        return;
      }
      close('enter');
    });
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function handleKeydown(event) {
    if (!isOpen) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close('dismiss');
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll(
      'button:not([disabled]), select, input, summary, [tabindex]:not([tabindex="-1"])'
    )).filter(function (node) { return !node.hidden && node.getClientRects().length > 0; });
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  window.SijiPopup = {
    show,
    close,
    isOpen: function () { return isOpen; }
  };
})();
