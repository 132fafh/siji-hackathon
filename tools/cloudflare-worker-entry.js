import api from '../server/api-fetch.js';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return api.handleFetchRequest(request, env || {});
    if (pathname === '/growth-validation.html') {
      return new Response('页面不存在。\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return env.ASSETS.fetch(request);
  },
};
