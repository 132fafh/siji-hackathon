'use strict';

const expression = process.argv[2];
if (!expression) throw new Error('缺少要执行的表达式');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`).then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && item.url.includes('localhost:8141'));
  if (!target) throw new Error('找不到思迹演示页面');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let serial = 0;
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    if (!value.id || !pending.has(value.id)) return;
    const { resolve, reject } = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) reject(new Error(JSON.stringify(value.error)));
    else resolve(value.result);
  });
  function call(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  const result = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result && result.result.value === undefined ? null : result.result.value, null, 2));
  socket.close();
  await sleep(20);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
