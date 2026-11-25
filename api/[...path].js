'use strict';

const { createServer } = require('../server/server');

const server = createServer();

module.exports = (req, res) => {
  const segments = Array.isArray(req.query && req.query.path)
    ? req.query.path
    : [req.query && req.query.path].filter(Boolean);
  const pathname = segments[0] === 'mock-kimi.html'
    ? '/mock-kimi.html'
    : `/api/${segments.map(encodeURIComponent).join('/')}`;
  const queryIndex = String(req.url || '').indexOf('?');
  req.url = pathname + (queryIndex >= 0 ? String(req.url).slice(queryIndex) : '');
  server.emit('request', req, res);
};
