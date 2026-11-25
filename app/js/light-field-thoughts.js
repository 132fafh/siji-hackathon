(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldThoughts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function saveThoughtEdit(session, bubbleId, keyword, note, timestamp) {
    const text = String(keyword == null ? '' : keyword).trim().slice(0, 40);
    if (!session || !session.id || !text) return null;
    const previous = session.lightThoughts && !Array.isArray(session.lightThoughts) ? session.lightThoughts : {};
    return {
      lightThoughts: Object.assign({}, previous, {
        [bubbleId]: {
          keyword: text,
          note: String(note == null ? '' : note).trim().slice(0, 240),
          updatedAt: timestamp || Date.now(),
        },
      }),
    };
  }

  function sourceSnippet(keyword, messages) {
    const text = String(keyword == null ? '' : keyword).trim();
    if (!text) return { found: false, snippet: '未提供关键词，无法确定来源。' };
    const message = (messages || []).find((item) => item.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
    if (!message) return { found: false, snippet: '未找到对应用户原话，来源不确定。' };
    const normalized = message.replace(/\s+/g, ' ').trim();
    return { found: true, snippet: normalized.length > 96 ? normalized.slice(0, 96) + '…' : normalized };
  }

  function detailForBubble(bubble, context) {
    const source = sourceSnippet(bubble.text, context.messages);
    return {
      keyword: bubble.text,
      source,
      probability: bubble.probability || 0,
      coherence: bubble.coherence || 0,
      coherenceLabel: '启发式收束度，不代表真实逻辑证明',
      hint: '点击进入局部思维导图，拖拽移动，长按分裂，双击编辑。',
    };
  }

  return { saveThoughtEdit, sourceSnippet, detailForBubble };
});
