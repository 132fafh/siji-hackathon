(function () {
  'use strict';

  const SJ = (window.SJ = window.SJ || {});
  const DATA_URL = 'demo-data/delidata-wason-constructive.json';
  let cached = null;

  async function load(fetchImpl) {
    if (cached) return cached;
    const request = fetchImpl || window.fetch.bind(window);
    const response = await request(DATA_URL);
    if (!response.ok) throw new Error('公开案例加载失败（HTTP ' + response.status + '）');
    cached = await response.json();
    return cached;
  }

  function transcript(data) {
    return data.turns.map((turn) => turn.speaker + ': ' + turn.text).join('\n');
  }

  async function createSession(fetchImpl) {
    const data = await load(fetchImpl);
    return {
      id: 'public-delidata-demo',
      title: 'DeliData 公开会话 · Wason 卡片选择任务',
      createdAt: 0,
      updatedAt: 0,
      status: 'demo',
      demoPublicCase: true,
      publicSource: data.source,
      original: { text: transcript(data), ts: 0 },
      rounds: [],
      misunderstandings: [],
      blanks: [],
      branches: [],
      confirmed: null,
      answer: null,
      aiSource: 'demo',
    };
  }

  SJ.publicDeliData = { load, createSession, transcript };
})();
