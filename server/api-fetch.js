'use strict';

const { HttpError, MAX_BODY_BYTES, handleAPIPayload } = require('./api-core');

function baseHeaders(request) {
  const origin = request.headers.get('origin');
  const headers = { 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function sendJSON(request, status, payload, extraHeaders) {
  return new Response(request.method === 'HEAD' ? undefined : JSON.stringify(payload), {
    status,
    headers: Object.assign(baseHeaders(request), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, extraHeaders),
  });
}

function pathnameOf(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', 'URL 路径编码无效。');
  }
  if (pathname.includes('\0') || pathname.includes('\\')) {
    throw new HttpError(400, 'INVALID_PATH', 'URL 路径包含无效字符。');
  }
  return pathname;
}

async function readRequestJSON(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求头 Content-Type 必须是 application/json。');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'JSON 请求体不能超过 64 KiB。');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'JSON 请求体不能超过 64 KiB。');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体必须是有效的 JSON。');
  }
  return value;
}

async function handleFetchRequest(request, env) {
  let pathname;
  try {
    pathname = pathnameOf(request);
    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: Object.assign(baseHeaders(request), {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        }),
      });
    }
    if (!pathname.startsWith('/api/')) {
      return sendJSON(request, 404, { error: { code: 'NOT_FOUND', message: 'API 路径不存在。' } });
    }
    const body = request.method === 'POST' ? await readRequestJSON(request) : undefined;
    const result = await handleAPIPayload({ pathname, method: request.method, body, env: env || {} });
    return sendJSON(request, result.status, result.payload, result.headers);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof HttpError ? error.message : '服务器暂时无法处理请求。';
    return sendJSON(request, status, { error: { code, message } });
  }
}

module.exports = { handleFetchRequest, readRequestJSON };
