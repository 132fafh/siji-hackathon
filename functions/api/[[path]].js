import api from '../../server/api-fetch.js';

export async function onRequest(context) {
  return api.handleFetchRequest(context.request, context.env || {});
}
