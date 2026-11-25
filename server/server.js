'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const demo = require('./demo-ai');
const expansionDemo = require('../app/js/demo-expansion.js');
const thoughtGraph = require('../app/js/thought-graph.js');
const preferenceVector = require('../app/js/preference-vector.js');
const graphKeywords = require('../app/js/graph-keywords.js');
const expansionGuard = require('../app/js/graph-expansion-guard.js');
const { createAIService, safeReason } = require('./ai-service');

const PORT = Number(process.env.PORT) || 8141;
const HOST = process.env.HOST || '127.0.0.1';
const APP_ROOT = path.resolve(__dirname, '..', 'app');
const MOCK_PAGE = path.join(__dirname, 'mock-kimi.html');
const MAX_BODY_BYTES = 64 * 1024;
const API_PATHS = new Set(['/api/restate', '/api/hints', '/api/expand', '/api/recall', '/api/answer']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLocalOrigin(origin) {
  return typeof origin === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);
}

function baseHeaders(req) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (isLocalOrigin(req.headers.origin)) {
    headers['Access-Control-Allow-Origin'] = req.headers.origin;
  }
  return headers;
}

function sendJSON(req, res, status, value, extraHeaders) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, Object.assign(baseHeaders(req), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendText(req, res, status, text, extraHeaders) {
  const body = Buffer.from(text);
  res.writeHead(status, Object.assign(baseHeaders(req), {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  }, extraHeaders || {}));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function requestPath(req) {
  const rawPath = String(req.url || '/').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch (error) {
    throw new HttpError(400, 'INVALID_PATH', 'URL 路径编码无效。');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new HttpError(400, 'INVALID_PATH', 'URL 路径包含无效字符。');
  }
  if (decoded.split('/').includes('..')) {
    throw new HttpError(403, 'PATH_TRAVERSAL', '禁止目录穿越。');
  }
  return decoded;
}

function resolveAppFile(decodedPath) {
  const relative = decodedPath.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(APP_ROOT, relative);
  const relation = path.relative(APP_ROOT, filePath);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new HttpError(403, 'PATH_TRAVERSAL', '禁止访问应用目录之外的文件。');
  }
  return filePath;
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(req, res, 404, '未找到文件。\n');
      return;
    }
    const headers = Object.assign(baseHeaders(req), {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
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

function readJSON(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      req.resume();
      reject(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求头 Content-Type 必须是 application/json。'));
      return;
    }
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      req.resume();
      reject(new HttpError(413, 'BODY_TOO_LARGE', 'JSON 请求体不能超过 64 KiB。'));
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'BODY_TOO_LARGE', 'JSON 请求体不能超过 64 KiB。'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        reject(new HttpError(400, 'INVALID_JSON', '请求体必须是有效的 JSON。'));
        return;
      }
      try {
        resolve(requireObject(value));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', () => reject(new HttpError(400, 'REQUEST_READ_ERROR', '请求体读取失败。')));
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

async function handleAPI(req, res, pathname, aiService) {
  if (pathname === '/api/health') {
    if (req.method !== 'GET') {
      sendJSON(req, res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '健康检查仅支持 GET。' } }, { Allow: 'GET' });
      return;
    }
    const configured = aiService.isConfigured();
    sendJSON(req, res, 200, {
      ok: true,
      service: 'siji-demo-server',
      demo: !configured,
      mode: configured ? 'api' : 'demo',
      meta: responseMeta(configured ? 'api' : 'demo', false, null),
      port: PORT,
    });
    return;
  }

  if (!API_PATHS.has(pathname)) {
    sendJSON(req, res, 404, { error: { code: 'NOT_FOUND', message: 'API 路径不存在。' } });
    return;
  }
  if (req.method !== 'POST') {
    sendJSON(req, res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '此 API 仅支持 POST。' } }, { Allow: 'POST' });
    return;
  }

  const body = await readJSON(req);
  if (pathname === '/api/restate') {
    const draft = requireDraft(body);
    const result = await generateWithFallback(aiService, 'restate', { draft }, () => ({ restatement: demo.restate(draft) }));
    sendJSON(req, res, 200, result);
  } else if (pathname === '/api/hints') {
    const draft = requireDraft(body);
    if (body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 10000)) {
      throw new HttpError(400, 'INVALID_OFFSET', '可选字段 offset 必须是 0 到 10000 的整数。');
    }
    const result = await generateWithFallback(aiService, 'hints', { draft, offset: body.offset || 0 }, () => ({ hints: demo.hints(draft, body.offset) }));
    sendJSON(req, res, 200, result);
  } else if (pathname === '/api/expand') {
    const input = validExpansion(body);
    if (input.count === 0) {
      sendJSON(req, res, 200, withMode({ candidates: [], reason: 'B=0：思维扩展已暂停，现有网络不会改变。' }, responseMeta('demo', false, null)));
      return;
    }
    const result = await generateWithFallback(
      aiService,
      'expand',
      input,
      () => expansionDemo.expand(input),
      (apiResult) => ({ candidates: apiResult.candidates })
    );
    result.candidates = preferenceVector.rankCandidates(result.candidates.map((candidate) => Object.assign({}, candidate, {
      action: input.action,
      demo: result.demo,
      sourceOrigin: 'ai',
    })), input.preferences);
    const deduped = expansionGuard.dedupeCandidates({ nodes: input.existingCandidates }, result.candidates);
    result.candidates = deduped.kept.slice(0, input.count);
    result.skippedDuplicates = (result.skippedDuplicates || []).concat(deduped.duplicates);
    if (!result.candidates.length) result.reason = '这条路径已有相同或高度相近的候选，不再重复生成。';
    if (result.demo && !result.notice) result.notice = '本地规则演示：只生成结构化思考提示，不是真实 AI 语义扩展。';
    sendJSON(req, res, 200, result);
  } else if (pathname === '/api/recall') {
    const draft = requireDraft(body);
    const messages = validMessages(body);
    const local = demo.recall(draft, messages);
    const result = await generateWithFallback(
      aiService,
      'recall',
      { draft, userMessages: messages, evidence: local.evidence },
      () => local,
      (apiResult) => Object.assign({}, local, {
        aiAdditions: local.evidence.length ? apiResult.aiAdditions : [],
        uncertainty: local.evidence.length
          ? `${local.uncertainty} AI 新增内容均为推测，不是用户原话。`
          : local.uncertainty,
      })
    );
    sendJSON(req, res, 200, result);
  } else if (pathname === '/api/answer') {
    const draft = requireDraft(body);
    const question = optionalQuestion(body);
    const result = await generateWithFallback(aiService, 'answer', { draft, question }, () => demo.answer({ draft, question }));
    sendJSON(req, res, 200, result);
  }
}

function handleRequest(req, res, aiService) {
  let pathname;
  try {
    pathname = requestPath(req);
    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, Object.assign(baseHeaders(req), {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      }));
      res.end();
      return;
    }
    if (pathname.startsWith('/api/')) {
      Promise.resolve(handleAPI(req, res, pathname, aiService)).catch((error) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const status = error instanceof HttpError ? error.status : 500;
        const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
        const message = error instanceof HttpError ? error.message : '服务器暂时无法处理请求。';
        sendJSON(req, res, status, { error: { code, message } });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(req, res, 405, '静态资源仅支持 GET 和 HEAD。\n', { Allow: 'GET, HEAD' });
      return;
    }
    if (pathname === '/mock-kimi.html') {
      serveFile(req, res, MOCK_PAGE);
      return;
    }
    if (pathname === '/growth-validation.html') {
      throw new HttpError(404, 'NOT_FOUND', '页面不存在。');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    serveFile(req, res, resolveAppFile(pathname));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof HttpError ? error.message : '服务器暂时无法处理请求。';
    if (pathname && pathname.startsWith('/api/')) sendJSON(req, res, status, { error: { code, message } });
    else sendText(req, res, status, `${message}\n`);
  }
}

function createServer(options) {
  const opts = options || {};
  const aiService = opts.aiService || createAIService({ env: opts.env || process.env });
  return http.createServer((req, res) => handleRequest(req, res, aiService));
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`思迹服务：http://localhost:${PORT}/`);
    console.log(`扩展测试页：http://localhost:${PORT}/mock-kimi.html`);
    console.log(process.env.SIJI_API_KEY ? '真实 AI 已配置；调用失败时将自动回退到演示模式。' : '当前为规则演示模式，未配置真实 AI。');
  });
}

module.exports = { createServer, APP_ROOT, MAX_BODY_BYTES };
