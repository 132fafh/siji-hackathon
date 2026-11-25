(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.thoughtSegments = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const NON_IDEA = /^(?:ok|okay|makes sense|sounds good(?: to me)?[.!]?|thanks(?: for.*)?|thank you.*|yes|agree|agreed)$/i;
  const MODERATION = /^(?:ok,\s*)?anything else\??$/i;
  const CONFIRMATION = /^[A-Z] it is,?$/;
  const TASK_REFERENCE = /^the rule is\b/i;
  const EMPTY_TOKENS = new Set(['the', 'is', 'to', 'of', 'and', 'a', 'an', 'on', 'in', 'it', 'this', 'that', '我', '你', '他', '她', '它', '的', '了', '和', '是', '在']);

  function cleanSegment(value) {
    return String(value || '').replace(/^[A-Za-z][A-Za-z0-9 _-]{0,30}:\s*/, '').replace(/^Well,\s*/i, '').replace(/[\s\u0000-\u001f]+/g, ' ').replace(/^[，,；;：:\s]+|[，,；;：:\s.]+$/g, '').trim();
  }

  function extractThoughtSegments(text, limit) {
    const lines = String(text || '').replace(/([.!?])\s+/g, '$1\n').split(/[\n\r。！？；]+/);
    const result = [];
    const seen = new Set();
    lines.forEach((line) => {
      const cleaned = cleanSegment(line);
      const parts = cleaned.length > 72 && !/^if\b/i.test(cleaned) ? cleaned.split(/[，,]/).map(cleanSegment) : [cleaned];
      parts.forEach((part) => {
        const value = part.trim();
        const key = value.toLocaleLowerCase();
        if (!value || value.length < 2 || value.length > 160 || seen.has(key)) return;
        if (!/[一-龥A-Za-z0-9]/.test(value) || EMPTY_TOKENS.has(key)) return;
        if (NON_IDEA.test(value) || MODERATION.test(value) || CONFIRMATION.test(value) || TASK_REFERENCE.test(value)) return;
        seen.add(key);
        result.push(value);
      });
    });
    return result.slice(0, limit || 48);
  }

  return { extractThoughtSegments };
});
