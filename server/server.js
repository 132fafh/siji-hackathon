'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createAIService } = require('./ai-service');
const { API_PATHS, HttpError, MAX_BODY_BYTES, handleAPIPayload } = require('./api-core');

const PORT = Number(process.env.PORT) || 8141;
const HOST = process.env.HOST || '127.0.0.1';
const APP_ROOT = path.resolve(__dirname, '..', 'app');
const MOCK_PAGE = path.join(__dirname, 'mock-kimi.html');
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

async function handleAPI(req, res, pathname, aiService) {
  const body = req.method === 'POST' && API_PATHS.has(pathname) ? await readJSON(req) : undefined;
  const result = await handleAPIPayload({ pathname, method: req.method, body, aiService, port: PORT });
  sendJSON(req, res, result.status, result.payload, result.headers);
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
