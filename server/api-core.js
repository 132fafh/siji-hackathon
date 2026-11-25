'use strict';

const demo = require('./demo-ai');
const expansionDemo = require('../app/js/demo-expansion.js');
const thoughtGraph = require('../app/js/thought-graph.js');
const preferenceVector = require('../app/js/preference-vector.js');
const graphKeywords = require('../app/js/graph-keywords.js');
const expansionGuard = require('../app/js/graph-expansion-guard.js');
const { createAIService, safeReason } = require('./ai-service');

const MAX_BODY_BYTES = 64 * 1024;
const API_PATHS = new Set(['/api/restate', '/api/hints', '/api/expand', '/api/recall', '/api/answer']);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_INPUT', 'JSON 顶层必须是对象。');
  }
  return value;
}

function requireDraft(body) {
  if (typeof body.draft !== 'string' || !body.draft.trim()) {
    throw new HttpError(400, 'INVALID_DRAFT', '字段 draft 必须是非空字符串。');
  }
  if (body.draft.length > 20000) {
    throw new HttpError(400, 'DRAFT_TOO_LONG', '字段 draft 不能超过 20000 个字符。');
  }
  return body.draft;
}

function optionalQuestion(body) {
  if (body.question === undefined) return '';
  if (typeof body.question !== 'string' || body.question.length > 2000) {
    throw new HttpError(400, 'INVALID_QUESTION', '可选字段 question 必须是不超过 2000 个字符的字符串。');
  }
  return body.question;
}

function validExpansion(body) {
  if (!body.node || typeof body.node !== 'object' || Array.isArray(body.node)) {
    throw new HttpError(400, 'INVALID_NODE', '字段 node 必须是对象。');
  }
  if (typeof body.node.text !== 'string' || !body.node.text.trim() || body.node.text.length > 500) {
    throw new HttpError(400, 'INVALID_NODE_TEXT', '节点文字必须是 1 到 500 个字符的字符串。');
  }
  if (body.node.sourceQuote !== undefined && (typeof body.node.sourceQuote !== 'string' || body.node.sourceQuote.length > 20000)) {
    throw new HttpError(400, 'INVALID_SOURCE_QUOTE', '节点原话必须是不超过 20000 个字符的字符串。');
  }
  const kind = thoughtGraph.classifyThought(body.node.text, { kind: body.node.kind });
  if (typeof body.action !== 'string' || !thoughtGraph.ACTIONS[body.action]) {
    throw new HttpError(400, 'INVALID_EXPANSION_ACTION', '不支持的扩展方式。');
  }
  if (!thoughtGraph.allowedActions(kind).some((item) => item.id === body.action)) {
    throw new HttpError(400, 'EXPANSION_NOT_ALLOWED', '这类节点暂不支持该扩展方式。');
  }
  const preferences = preferenceVector.createPreferences(body.preferences);
  const count = body.count === undefined ? preferences.count : Number(body.count);
  if (![0, 1, 2, 3].includes(count)) {
    throw new HttpError(400, 'INVALID_EXPANSION_COUNT', '思维拓展量 B 必须是 0、1、2 或 3。');
  }
  if (body.existingCandidates !== undefined && (!Array.isArray(body.existingCandidates) || body.existingCandidates.length > 200)) {
    throw new HttpError(400, 'INVALID_EXISTING_CANDIDATES', '已有候选必须是最多 200 项的数组。');
  }
  const existingCandidates = (body.existingCandidates || []).map((item, index) => {
    if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500) {
      throw new HttpError(400, 'INVALID_EXISTING_CANDIDATE', `existingCandidates[${index}].text 必须是 1 到 500 个字符的字符串。`);
    }
    return { text: item.text.trim(), sourceOrigin: item.sourceOrigin === 'ai' ? 'ai' : 'human', status: ['candidate', 'accepted', 'rejected', 'active'].includes(item.status) ? item.status : 'active' };
  });
  const original = body.context && typeof body.context.original === 'string' ? body.context.original.slice(0, 20000) : '';
  return {
    node: { text: body.node.text.trim(), kind, sourceQuote: body.node.sourceQuote || '' },
    action: body.action,
    count,
    preferences,
    exploration: graphKeywords.createFocusPreferences({ exploration: body.exploration }).exploration,
    existingCandidates,
    context: { original },
  };
}

function validMessages(body) {
  if (body.userMessages === undefined) return [];
  if (!Array.isArray(body.userMessages) || body.userMessages.length > 100) {
    throw new HttpError(400, 'INVALID_MESSAGES', '字段 userMessages 必须是最多 100 项的数组。');
  }
  return body.userMessages.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new HttpError(400, 'INVALID_MESSAGE', `userMessages[${index}] 必须是对象。`);
    }
    if (typeof message.id !== 'string' || !message.id.trim() || message.id.length > 128) {
      throw new HttpError(400, 'INVALID_MESSAGE_ID', `userMessages[${index}].id 必须是非空且不超过 128 个字符的字符串。`);
    }
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 20000) {
      throw new HttpError(400, 'INVALID_MESSAGE_TEXT', `userMessages[${index}].text 必须是非空且不超过 20000 个字符的字符串。`);
    }
    return { id: message.id, text: message.text };
  });
}

function responseMeta(actualMode, fallback, reason) {
  return { actualMode, fallback, reason: reason || null };
}

function withMode(payload, meta) {
  return Object.assign({}, payload, {
    demo: meta.actualMode === 'demo',
    mode: meta.actualMode,
    meta,
  });
}

async function generateWithFallback(aiService, task, input, demoResult, adaptAPIResult) {
  if (!aiService.isConfigured()) {
    return withMode(demoResult(), responseMeta('demo', false, null));
  }
  try {
    const apiResult = await aiService.generate(task, input);
    const adapted = adaptAPIResult ? adaptAPIResult(apiResult) : apiResult;
    return withMode(adapted, responseMeta('api', false, null));
  } catch (error) {
    return withMode(demoResult(), responseMeta('demo', true, safeReason(error)));
  }
}

function result(status, payload, headers) {
  return { status, payload, headers };
}

async function handleAPIPayload(options) {
  const opts = options || {};
  const pathname = opts.pathname;
  const method = opts.method;
  const aiService = opts.aiService || createAIService({ env: opts.env || {} });
  if (pathname === '/api/health') {
    if (method !== 'GET') return result(405, { error: { code: 'METHOD_NOT_ALLOWED', message: '健康检查仅支持 GET。' } }, { Allow: 'GET' });
    const configured = aiService.isConfigured();
    return result(200, {
      ok: true,
      service: 'siji-demo-server',
      demo: !configured,
      mode: configured ? 'api' : 'demo',
      meta: responseMeta(configured ? 'api' : 'demo', false, null),
      port: opts.port,
    });
  }
  if (!API_PATHS.has(pathname)) return result(404, { error: { code: 'NOT_FOUND', message: 'API 路径不存在。' } });
  if (method !== 'POST') return result(405, { error: { code: 'METHOD_NOT_ALLOWED', message: '此 API 仅支持 POST。' } }, { Allow: 'POST' });
  const body = requireObject(opts.body);
  if (pathname === '/api/restate') {
    const draft = requireDraft(body);
    return result(200, await generateWithFallback(aiService, 'restate', { draft }, () => ({ restatement: demo.restate(draft) })));
  }
  if (pathname === '/api/hints') {
    const draft = requireDraft(body);
    if (body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 10000)) {
      throw new HttpError(400, 'INVALID_OFFSET', '可选字段 offset 必须是 0 到 10000 的整数。');
    }
    return result(200, await generateWithFallback(aiService, 'hints', { draft, offset: body.offset || 0 }, () => ({ hints: demo.hints(draft, body.offset) })));
  }
  if (pathname === '/api/expand') {
    const input = validExpansion(body);
    if (input.count === 0) {
      return result(200, withMode({ candidates: [], reason: 'B=0：思维扩展已暂停，现有网络不会改变。' }, responseMeta('demo', false, null)));
    }
    const expanded = await generateWithFallback(aiService, 'expand', input, () => expansionDemo.expand(input), (apiResult) => ({ candidates: apiResult.candidates }));
    expanded.candidates = preferenceVector.rankCandidates(expanded.candidates.map((candidate) => Object.assign({}, candidate, {
      action: input.action,
      demo: expanded.demo,
      sourceOrigin: 'ai',
    })), input.preferences);
    const deduped = expansionGuard.dedupeCandidates({ nodes: input.existingCandidates }, expanded.candidates);
    expanded.candidates = deduped.kept.slice(0, input.count);
    expanded.skippedDuplicates = (expanded.skippedDuplicates || []).concat(deduped.duplicates);
    if (!expanded.candidates.length) expanded.reason = '这条路径已有相同或高度相近的候选，不再重复生成。';
    if (expanded.demo && !expanded.notice) expanded.notice = '本地规则演示：只生成结构化思考提示，不是真实 AI 语义扩展。';
    return result(200, expanded);
  }
  if (pathname === '/api/recall') {
    const draft = requireDraft(body);
    const messages = validMessages(body);
    const local = demo.recall(draft, messages);
    return result(200, await generateWithFallback(aiService, 'recall', { draft, userMessages: messages, evidence: local.evidence }, () => local, (apiResult) => Object.assign({}, local, {
      aiAdditions: local.evidence.length ? apiResult.aiAdditions : [],
      uncertainty: local.evidence.length ? `${local.uncertainty} AI 新增内容均为推测，不是用户原话。` : local.uncertainty,
    })));
  }
  const draft = requireDraft(body);
  const question = optionalQuestion(body);
  return result(200, await generateWithFallback(aiService, 'answer', { draft, question }, () => demo.answer({ draft, question })));
}

module.exports = { API_PATHS, HttpError, MAX_BODY_BYTES, handleAPIPayload };
