(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SijiSiteAdapters = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const GENERIC_EDITOR_SELECTORS = [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]'
  ];
  const GENERIC_MESSAGE_SELECTORS = [
    '[data-message-author-role]',
    '[data-author-role]',
    '[data-role="user"]',
    '[data-role="assistant"]',
    '[data-message-id]',
    'article',
    '[role="article"]',
    'main [role="listitem"]'
  ];
  const BUILT_IN_SITES = [
    { id: 'kimi', name: 'Kimi', hosts: ['kimi.com', 'www.kimi.com'], editorSelectors: ['.chat-input', '[contenteditable]', 'textarea'] },
    { id: 'chatgpt', name: 'ChatGPT', hosts: ['chat.openai.com', 'chatgpt.com'], editorSelectors: ['#prompt-textarea', '[contenteditable]', 'textarea'] },
    { id: 'claude', name: 'Claude', hosts: ['claude.ai'], editorSelectors: ['[contenteditable]', 'textarea'] },
    { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], editorSelectors: ['.ql-editor', '[contenteditable]', 'textarea'] },
    { id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'doubao', name: '豆包', hosts: ['doubao.com', 'www.doubao.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'qwen', name: '通义千问', hosts: ['qianwen.com', 'www.qianwen.com', 'tongyi.aliyun.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'yuanbao', name: '腾讯元宝', hosts: ['yuanbao.tencent.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'zhipu', name: '智谱清言', hosts: ['chat.zhipu.cn', 'chatglm.cn'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'poe', name: 'Poe', hosts: ['poe.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'perplexity', name: 'Perplexity', hosts: ['perplexity.ai', 'www.perplexity.ai'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'copilot', name: 'Microsoft Copilot', hosts: ['copilot.microsoft.com'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'mistral', name: 'Mistral Le Chat', hosts: ['chat.mistral.ai'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'grok', name: 'Grok', hosts: ['grok.com', 'x.ai'], editorSelectors: ['textarea', '[contenteditable]'] },
    { id: 'mock', name: '本地模拟页', hosts: ['localhost', '127.0.0.1'], editorSelectors: ['#prompt-input', 'textarea', '[contenteditable]'] }
  ];

  function hostMatches(hostname, domain) {
    const host = String(hostname || '').toLowerCase();
    const expected = String(domain || '').toLowerCase();
    return host === expected || host.endsWith('.' + expected);
  }

  function withAdapter(site, location) {
    const genericEditor = site.editorSelectors.concat(GENERIC_EDITOR_SELECTORS);
    return Object.assign({}, site, {
      builtIn: true,
      editorSelector: Array.from(new Set(genericEditor)).join(','),
      messageSelector: GENERIC_MESSAGE_SELECTORS.join(','),
      url: location && location.href ? location.href : ''
    });
  }

  function detect(location) {
    const hostname = location && location.hostname ? location.hostname : '';
    const site = BUILT_IN_SITES.find((item) => item.hosts.some((host) => hostMatches(hostname, host)));
    return site ? withAdapter(site, location) : null;
  }

  function genericAdapter(location) {
    return withAdapter({ id: 'custom', name: '手动启用的站点', hosts: [], editorSelectors: [] }, location);
  }

  function whenReady(location, callback) {
    const builtIn = detect(location);
    if (builtIn) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        callback(builtIn);
        return;
      }
      chrome.storage.local.get('sijiDisabledHosts', function (stored) {
        const hosts = stored && Array.isArray(stored.sijiDisabledHosts) ? stored.sijiDisabledHosts : [];
        callback(hosts.includes(location.hostname) ? null : builtIn);
      });
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      callback(null);
      return;
    }
    chrome.storage.local.get('sijiEnabledHosts', function (stored) {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      const hosts = stored && Array.isArray(stored.sijiEnabledHosts) ? stored.sijiEnabledHosts : [];
      callback(hosts.includes(location.hostname) ? genericAdapter(location) : null);
    });
  }

  return { BUILT_IN_SITES, GENERIC_EDITOR_SELECTORS, GENERIC_MESSAGE_SELECTORS, hostMatches, detect, genericAdapter, whenReady };
});
