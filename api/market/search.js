import {
  handleGuruProfileRequest,
  handleGuruQuotesRequest,
  handleGuruSearchRequest,
  handleMarketSearchRequest,
} from '../../server/apiHandlers.mjs';
import { resolveClientKey } from '../../server/rateLimit.mjs';
import { sendJson } from '../_utils/http.js';

// One function serves four routes. Vercel's Hobby plan allows 12 serverless functions per
// deployment and the app already used all 12, so the 유명인 tab's endpoints ride on this one:
// vercel.json rewrites /api/gurus/{search,profile,quotes} here with `route=gurus-…`.
const GURU_ROUTES = {
  'gurus-search': handleGuruSearchRequest,
  'gurus-profile': handleGuruProfileRequest,
  'gurus-quotes': handleGuruQuotesRequest,
};

export default async function handler(request, response) {
  const clientKey = resolveClientKey(request);
  const route = Array.isArray(request.query?.route) ? request.query.route[0] : request.query?.route;
  const handle = GURU_ROUTES[route] ?? handleMarketSearchRequest;

  await handle({
    method: request.method,
    clientKey,
    query: request.query,
    sendJson: (status, payload, headers) => sendJson(response, status, payload, headers),
  });
}
