'use strict';

importScripts('shared/site-adapters.js');

const SIJI_PLUGIN_URL = 'http://localhost:8141/#/plugin';

function textValue(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeUserMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(function (message) {
    return message && textValue(message.text).trim();
  }).slice(-20).map(function (message, index) {
    return {
      id: textValue(message.id) || `user-${index + 1}`,
      text: textValue(message.text),
      timestamp: Number.isFinite(message.timestamp) ? message.timestamp : 0
    };
  });
}

async function enterSiji(message, sender) {
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  const userMessages = normalizeUserMessages(payload.userMessages);
  const latestUserMessage = userMessages.length
    ? userMessages[userMessages.length - 1].text
    : '';
  const candidates = [payload.draft, payload.selectedText, latestUserMessage];
  const draft = candidates.find(function (value) {
    return textValue(value).trim().length > 0;
  });

  if (!textValue(draft).trim()) {
    return {
      ok: false,
      error: '没有可交接的草稿、选中文本或近期用户消息。请先输入或选择内容。'
    };
  }

  const handoff = {
    draft: textValue(draft),
    userMessages,
    sourceUrl: sender.tab && sender.tab.url ? sender.tab.url : textValue(payload.sourceUrl),
    createdAt: Date.now()
  };

  await chrome.storage.local.set({ sijiHandoff: handoff });
  await chrome.tabs.create({ url: SIJI_PLUGIN_URL });
  return { ok: true };
}

async function siteStatus(tab) {
  const url = new URL(tab.url);
  if (!/^https?:$/.test(url.protocol)) throw new Error('当前页面不是受支持的网页。');
  const adapter = SijiSiteAdapters.detect(url);
  const stored = await chrome.storage.local.get(['sijiEnabledHosts', 'sijiDisabledHosts']);
  const enabledHosts = stored.sijiEnabledHosts || [];
  const disabledHosts = stored.sijiDisabledHosts || [];
  return {
    ok: true,
    hostname: url.hostname,
    siteName: adapter ? adapter.name : '未识别站点',
    builtIn: Boolean(adapter),
    enabled: adapter ? !disabledHosts.includes(url.hostname) : enabledHosts.includes(url.hostname)
  };
}

async function toggleSijiSite(tab) {
  const status = await siteStatus(tab);
  const adapter = SijiSiteAdapters.detect(new URL(tab.url));
  const key = adapter ? 'sijiDisabledHosts' : 'sijiEnabledHosts';
  const stored = await chrome.storage.local.get(key);
  const hosts = new Set(stored[key] || []);
  if (status.enabled) hosts.delete(tab.url ? new URL(tab.url).hostname : '');
  else hosts.add(new URL(tab.url).hostname);
  if (adapter) {
    if (status.enabled) hosts.add(new URL(tab.url).hostname);
    else hosts.delete(new URL(tab.url).hostname);
  }
  await chrome.storage.local.set({ [key]: Array.from(hosts) });
  const next = await siteStatus(tab);
  await chrome.tabs.sendMessage(tab.id, { type: 'siji-site-changed', enabled: next.enabled });
  return next;
}

function tabForMessage(message, sender) {
  if (message.tabId) return chrome.tabs.get(message.tabId);
  return Promise.resolve(sender.tab);
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;
  if (message.type === 'getSijiSiteStatus') {
    tabForMessage(message, sender).then(siteStatus).then(sendResponse).catch(function (error) {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message.type === 'toggleSijiSite') {
    tabForMessage(message, sender).then(toggleSijiSite).then(sendResponse).catch(function (error) {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }
  if (message.type !== 'enterSiji') return false;
  enterSiji(message, sender).then(sendResponse).catch(function () {
    sendResponse({
      ok: false,
      error: '无法保存草稿或打开思迹，请确认本地服务已启动后重试。'
    });
  });
  return true;
});
