'use strict';

const siteName = document.getElementById('site-name');
const siteHost = document.getElementById('site-host');
const siteStatus = document.getElementById('site-status');
const toggleButton = document.getElementById('toggle-site');
let currentTab = null;

function render(result) {
  if (!result || !result.ok) {
    siteName.textContent = '当前页面无法启用';
    siteStatus.textContent = result && result.error ? result.error : '请在一个 AI 对话网页中打开扩展。';
    toggleButton.disabled = true;
    return;
  }
  siteName.textContent = result.siteName;
  siteHost.textContent = result.hostname;
  siteStatus.textContent = result.enabled
    ? '思迹已在此站点启用。'
    : result.builtIn ? '思迹已在此站点停用。' : '这是未识别站点，只有手动启用后才会分析。';
  toggleButton.textContent = result.enabled ? '在此站点停用思迹' : '在此站点启用思迹';
  toggleButton.disabled = false;
}

async function withTab(callback) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
  return callback(currentTab);
}

toggleButton.addEventListener('click', async () => {
  toggleButton.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'toggleSijiSite', tabId: currentTab && currentTab.id });
  render(result);
});

withTab((tab) => chrome.runtime.sendMessage({ type: 'getSijiSiteStatus', tabId: tab && tab.id })).then(render).catch((error) => {
  render({ ok: false, error: error.message });
});
