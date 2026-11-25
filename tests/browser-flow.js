/* 可选真实浏览器联调：先以 --remote-debugging-port=9222 启动加载扩展的 Edge，再运行本文件。 */
const assert = require('node:assert/strict');

const DEBUG_URL = 'http://localhost:9222';
const DRAFT = '我在思考怎样把原来的想法说清楚，但写到这里突然不知道下一句该怎么接。';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tabs() {
  const response = await fetch(DEBUG_URL + '/json/list');
  return response.json();
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.contexts = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
        return;
      }
      if (data.method === 'Runtime.executionContextCreated') {
        this.contexts.push(data.params.context);
        console.error('CDP_CONTEXT', JSON.stringify(data.params.context.auxData));
      }
    };
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function evaluate(cdp, expression, contextId) {
  const params = { expression, returnByValue: true };
  if (contextId) params.contextId = contextId;
  const result = await cdp.send('Runtime.evaluate', params);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

(async () => {
  const page = (await tabs()).find((tab) => tab.type === 'page' && tab.url.includes('mock-kimi.html'));
  assert(page, '未找到 mock 页面');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  const previousContext = cdp.contexts.findLast((item) => item.auxData && item.auxData.isDefault === false);
  if (previousContext) {
    await evaluate(cdp, 'new Promise((resolve) => chrome.storage.local.remove("sijiLastPopupAt", resolve))', previousContext.id);
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1500);
  }
  await evaluate(cdp, `(() => {
    const input = document.querySelector('#prompt-input');
    input.value = ${JSON.stringify(DRAFT)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  await sleep(13000);
  const context = cdp.contexts.findLast((item) => item.auxData && item.auxData.isDefault === false);
  assert(context, '未找到扩展隔离上下文');
  const popupOpen = await evaluate(cdp, 'window.SijiPopup.isOpen()', context.id);
  assert.equal(popupOpen, true, '弹窗未触发');
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === '进入思迹');
    if (!button) throw new Error('未找到进入思迹按钮');
    button.click();
    return true;
  })()`, context.id);
  await sleep(4000);
  const sijiTab = (await tabs()).find((tab) => tab.type === 'page' && tab.url.includes('#/s/'));
  assert(sijiTab, '未进入思迹工作区');
  const receiver = new CDP(sijiTab.webSocketDebuggerUrl);
  await receiver.open();
  const original = await evaluate(receiver, 'SJ.store.listSessions()[0].original.text');
  assert.equal(original, DRAFT, '草稿未正确写入原始表达');
  console.log('BROWSER_FLOW_PASS: 输入 → 停顿 → 弹窗 → 进入思迹 → 原始表达保存');
  receiver.close();
  cdp.close();
  process.exit(0);
})().catch((error) => {
  console.error('BROWSER_FLOW_FAIL:', error.message);
  process.exit(1);
});
