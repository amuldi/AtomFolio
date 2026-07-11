import { ingestPortfolioText } from './portfolioIngestion.mjs';
import {
  enrichSecurityIdentifiers,
  enrichSecurityItems,
  getSecurityEnrichmentCacheStats,
} from './securityEnrichment.mjs';
import { searchMarketSymbolSuggestions } from '../src/lib/liveMarketData.js';
import { fetchCompanyFinancialsFromProviders } from '../src/lib/companyFinancials.js';
import { fetchMarketNewsFromProviders } from '../src/lib/marketNews.js';
import {
  claimGuestWorkspaceForUser,
  createPortfolio,
  deletePortfolio,
  getPortfolio,
  getPortfolioStoreStatus,
  listImportHistory,
  listPortfolios,
  saveImportHistory,
  updatePortfolio,
} from './portfolioStore.mjs';
import { createPortfolioSummaryAnalysis } from './ai/portfolioSummary.mjs';
import {
  getOperationalEventStats,
  recordOperationalEvent,
} from './operationalEvents.mjs';
import { checkRateLimit } from './rateLimit.mjs';
import {
  getLiveMarketDataWithCache,
  getMarketDataCacheStats,
} from './marketDataCache.mjs';

const RATE_LIMITS = {
  'ai-portfolio-summary': { limit: 5 },
  'market-live': { limit: 30 },
  'market-search': { limit: 30 },
  'market-news': { limit: 30 },
  'market-financials': { limit: 30 },
  'security-enrich': { limit: 10 },
  'portfolio-ingest': { limit: 10 },
};

function enforceRateLimit(bucket, clientKey, sendJson) {
  const config = RATE_LIMITS[bucket];
  if (!config) {
    return true;
  }

  const result = checkRateLimit({ bucket, clientKey, limit: config.limit });
  if (result.ok) {
    return true;
  }

  recordOperationalEvent({
    level: 'warn',
    area: 'rate-limit',
    code: `${bucket}-rate-limited`,
    message: `Rate limit exceeded for ${bucket}.`,
    metadata: { retryAfterSeconds: result.retryAfterSeconds },
  });
  sendJson(
    429,
    {
      error: 'Too many requests. Retry shortly.',
      code: 'rate-limited',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { 'Retry-After': String(result.retryAfterSeconds) },
  );
  return false;
}

const MAX_FILE_NAME_LENGTH = 180;
const MAX_PORTFOLIO_ITEMS = 5000;
const MAX_TIMELINE_ITEMS = 20000;
const MAX_SECURITY_ENRICH_ITEMS = 500;
const MAX_IDENTIFIER_COUNT = 500;
const MAX_IMPORT_FIELD_BYTES = 256 * 1024;

function queryValue(query, ...keys) {
  for (const key of keys) {
    if (typeof query?.get === 'function') {
      const value = query.get(key);
      if (value != null) {
        return value;
      }
      continue;
    }

    const value = query?.[key];
    if (Array.isArray(value)) {
      if (value[0] != null) {
        return value[0];
      }
      continue;
    }
    if (value != null) {
      return value;
    }
  }

  return '';
}

function cleanQueryText(value, maxLength = 120) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return Infinity;
  }
}

function validateArrayLimit(value, fieldName, maxLength) {
  if (value == null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return `${fieldName} must be an array.`;
  }

  if (value.length > maxLength) {
    return `${fieldName} is limited to ${maxLength} entries.`;
  }

  return null;
}

function validatePortfolioPayload(input) {
  if (!isPlainObject(input)) {
    return 'Portfolio payload must be an object.';
  }

  if (input.id != null && String(input.id).length > 120) {
    return 'Portfolio id is too long.';
  }

  if (input.fileName != null && String(input.fileName).length > MAX_FILE_NAME_LENGTH) {
    return 'Portfolio fileName is too long.';
  }

  return (
    validateArrayLimit(input.items, 'items', MAX_PORTFOLIO_ITEMS) ??
    validateArrayLimit(input.timelineItems, 'timelineItems', MAX_TIMELINE_ITEMS)
  );
}

function validateImportPayload(input) {
  if (!isPlainObject(input)) {
    return 'Import payload must be an object.';
  }

  if (input.id != null && String(input.id).length > 120) {
    return 'Import id is too long.';
  }

  if (input.fileName != null && String(input.fileName).length > MAX_FILE_NAME_LENGTH) {
    return 'Import fileName is too long.';
  }

  if (jsonByteLength(input.parserDiagnostics) > MAX_IMPORT_FIELD_BYTES) {
    return 'parserDiagnostics is too large.';
  }

  if (jsonByteLength(input.agentReview) > MAX_IMPORT_FIELD_BYTES) {
    return 'agentReview is too large.';
  }

  return null;
}

function sendMethodNotAllowed(sendJson) {
  sendJson(405, { error: 'Method not allowed.' });
}

function errorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage;
}

function recordApiError(area, code, error, metadata = {}) {
  recordOperationalEvent({
    level: 'error',
    area,
    code,
    message: errorMessage(error, 'Request failed.'),
    metadata,
  });
}

function sendProviderError(sendJson, error, fallbackMessage, code = 'provider-error') {
  recordApiError('provider', code, error);
  sendJson(502, {
    error: errorMessage(error, fallbackMessage),
  });
}

export async function handleHealthRequest({ method, query, sendJson }) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  sendJson(200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    uptimeSeconds:
      typeof process !== 'undefined' && typeof process.uptime === 'function'
        ? Math.round(process.uptime())
        : null,
    portfolioStore: getPortfolioStoreStatus(),
    securityEnrichment: getSecurityEnrichmentCacheStats(),
    marketDataCache: getMarketDataCacheStats(),
    operationalEvents: getOperationalEventStats({
      includeRecent: queryValue(query, 'details') === 'events',
    }),
  });
}

export async function handleMarketLiveRequest({ method, query, clientKey, sendJson }) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('market-live', clientKey, sendJson)) {
    return;
  }

  try {
    const ticker = cleanQueryText(queryValue(query, 'ticker'), 40);
    const name = cleanQueryText(queryValue(query, 'name'), 120);

    if (!ticker && !name) {
      sendJson(400, { error: 'Provide ticker or name.' });
      return;
    }

    sendJson(200, await getLiveMarketDataWithCache({ ticker, name }));
  } catch (error) {
    sendProviderError(sendJson, error, 'Market data fetch failed.', 'market-live-failed');
  }
}

export async function handleMarketSearchRequest({ method, query, clientKey, sendJson }) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('market-search', clientKey, sendJson)) {
    return;
  }

  try {
    const searchQuery = cleanQueryText(queryValue(query, 'query', 'q'), 120);
    const limit = Math.min(12, Math.max(1, Number(queryValue(query, 'limit') || 10) || 10));

    if (searchQuery.length < 2 && !/[가-힣]/.test(searchQuery)) {
      sendJson(200, { suggestions: [] });
      return;
    }

    const suggestions = await searchMarketSymbolSuggestions(searchQuery, { limit });
    sendJson(200, { suggestions });
  } catch (error) {
    sendProviderError(sendJson, error, 'Market search failed.', 'market-search-failed');
  }
}

export async function handleMarketFinancialsRequest({ method, query, clientKey, sendJson }) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('market-financials', clientKey, sendJson)) {
    return;
  }

  try {
    const ticker = cleanQueryText(queryValue(query, 'ticker'), 40);
    const name = cleanQueryText(queryValue(query, 'name'), 120);

    if (!ticker && !name) {
      sendJson(400, { error: 'Provide ticker or name.' });
      return;
    }

    sendJson(200, await fetchCompanyFinancialsFromProviders({ ticker, name }));
  } catch (error) {
    sendProviderError(sendJson, error, 'Company financials fetch failed.', 'market-financials-failed');
  }
}

export async function handleMarketNewsRequest({ method, query, clientKey, sendJson }) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('market-news', clientKey, sendJson)) {
    return;
  }

  try {
    const newsQuery = cleanQueryText(queryValue(query, 'query'), 80);
    const tickers = String(queryValue(query, 'tickers') ?? '')
      .split(',')
      .map((ticker) => ticker.trim().slice(0, 18))
      .filter(Boolean)
      .slice(0, 5);
    const language = queryValue(query, 'language') === 'en' ? 'en' : 'ko';
    const mode = queryValue(query, 'mode') === 'search' ? 'search' : 'today';
    const refreshKey = cleanQueryText(queryValue(query, '_ts', 'refresh'), 32);

    sendJson(
      200,
      await fetchMarketNewsFromProviders({
        query: newsQuery,
        tickers,
        language,
        mode,
        refreshKey,
      }),
    );
  } catch (error) {
    sendProviderError(sendJson, error, 'Market news fetch failed.', 'market-news-failed');
  }
}

export async function handleSecurityEnrichRequest({ method, readBody, clientKey, sendJson }) {
  if (method !== 'POST') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('security-enrich', clientKey, sendJson)) {
    return;
  }

  try {
    const body = await readBody();
    if (!isPlainObject(body)) {
      sendJson(400, { error: 'Request body must be a JSON object.' });
      return;
    }

    const force = Boolean(body.force);

    if (Array.isArray(body.items)) {
      const validationError = validateArrayLimit(body.items, 'items', MAX_SECURITY_ENRICH_ITEMS);
      if (validationError) {
        sendJson(400, { error: validationError });
        return;
      }

      sendJson(200, await enrichSecurityItems(body.items, { force }));
      return;
    }

    if (Array.isArray(body.identifiers)) {
      const validationError = validateArrayLimit(body.identifiers, 'identifiers', MAX_IDENTIFIER_COUNT);
      if (validationError) {
        sendJson(400, { error: validationError });
        return;
      }

      sendJson(200, await enrichSecurityIdentifiers(body.identifiers, { force }));
      return;
    }

    sendJson(400, {
      error: 'Provide an items array or identifiers array.',
    });
  } catch (error) {
    recordApiError('security-enrichment', 'security-enrichment-failed', error);
    sendJson(500, {
      error: errorMessage(error, 'Security enrichment failed.'),
    });
  }
}

export async function handlePortfolioIngestRequest({ method, readBody, clientKey, sendJson }) {
  if (method !== 'POST') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('portfolio-ingest', clientKey, sendJson)) {
    return;
  }

  try {
    const body = await readBody();
    if (!isPlainObject(body)) {
      sendJson(400, { error: 'Request body must be a JSON object.' });
      return;
    }

    const fileName = cleanQueryText(body.fileName, MAX_FILE_NAME_LENGTH) || 'portfolio.csv';
    const text = String(body.text ?? '');

    if (!text.trim()) {
      sendJson(400, { error: 'Upload text is empty.' });
      return;
    }

    sendJson(200, await ingestPortfolioText(fileName, text));
  } catch (error) {
    recordApiError('portfolio-ingest', 'portfolio-ingest-failed', error);
    sendJson(500, {
      error: errorMessage(error, 'Portfolio ingestion failed.'),
    });
  }
}

export async function handlePortfolioCollectionRequest({
  method,
  workspaceId,
  readBody,
  sendJson,
}) {
  try {
    if (method === 'GET') {
      sendJson(200, await listPortfolios(workspaceId));
      return;
    }

    if (method === 'POST') {
      const body = await readBody();
      const validationError = validatePortfolioPayload(body);
      if (validationError) {
        sendJson(400, { error: validationError });
        return;
      }

      sendJson(201, await createPortfolio(workspaceId, body));
      return;
    }

    sendMethodNotAllowed(sendJson);
  } catch (error) {
    recordApiError('portfolio', 'portfolio-collection-failed', error, { method, workspaceId });
    sendJson(500, {
      error: errorMessage(error, 'Portfolio API failed.'),
    });
  }
}

export async function handlePortfolioImportsRequest({
  method,
  workspaceId,
  readBody,
  sendJson,
}) {
  try {
    if (method === 'GET') {
      sendJson(200, await listImportHistory(workspaceId));
      return;
    }

    if (method === 'POST') {
      const body = await readBody();
      const validationError = validateImportPayload(body);
      if (validationError) {
        sendJson(400, { error: validationError });
        return;
      }

      sendJson(201, await saveImportHistory(workspaceId, body));
      return;
    }

    sendMethodNotAllowed(sendJson);
  } catch (error) {
    recordApiError('portfolio-imports', 'portfolio-imports-failed', error, { method, workspaceId });
    sendJson(500, {
      error: errorMessage(error, 'Import history API failed.'),
    });
  }
}

export async function handlePortfolioItemRequest({
  method,
  workspaceId,
  portfolioId,
  readBody,
  sendJson,
}) {
  if (!portfolioId) {
    sendJson(400, { error: 'Portfolio id is required.' });
    return;
  }

  try {
    if (method === 'GET') {
      const portfolio = await getPortfolio(workspaceId, portfolioId);
      if (!portfolio) {
        sendJson(404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(200, { workspaceId, portfolio });
      return;
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody();
      const validationError = validatePortfolioPayload(body);
      if (validationError) {
        sendJson(400, { error: validationError });
        return;
      }

      const payload = await updatePortfolio(workspaceId, portfolioId, body);
      if (!payload) {
        sendJson(404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(200, payload);
      return;
    }

    if (method === 'DELETE') {
      const deleted = await deletePortfolio(workspaceId, portfolioId);
      if (!deleted) {
        sendJson(404, { error: 'Portfolio not found.' });
        return;
      }

      sendJson(200, { workspaceId, deleted: true, id: portfolioId });
      return;
    }

    sendMethodNotAllowed(sendJson);
  } catch (error) {
    recordApiError('portfolio', 'portfolio-item-failed', error, {
      method,
      workspaceId,
      portfolioId,
    });
    sendJson(500, {
      error: errorMessage(error, 'Portfolio API failed.'),
    });
  }
}

export async function handleWorkspaceSessionRequest({
  method,
  workspaceSession,
  sendJson,
}) {
  if (method !== 'GET') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  sendJson(200, {
    authenticated: Boolean(workspaceSession?.authenticated),
    trusted: Boolean(workspaceSession?.trusted),
    workspaceId: String(workspaceSession?.workspaceId ?? ''),
    user: workspaceSession?.user ?? null,
  });
}

export async function handleWorkspaceClaimGuestRequest({
  method,
  authContext,
  readBody,
  sendJson,
}) {
  if (method !== 'POST') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!authContext?.user) {
    sendJson(401, {
      error: 'Authentication is required to claim a guest workspace.',
      code: 'workspace-auth-required',
    });
    return;
  }

  try {
    const body = await readBody();
    if (!isPlainObject(body)) {
      sendJson(400, { error: 'Request body must be a JSON object.' });
      return;
    }

    const guestWorkspaceId = cleanQueryText(body.guestWorkspaceId, 80);
    const targetWorkspaceId =
      cleanQueryText(body.targetWorkspaceId, 80) || `user:${authContext.user.id}`;

    const payload = await claimGuestWorkspaceForUser({
      guestWorkspaceId,
      targetWorkspaceId,
      user: authContext.user,
      removeGuest: Boolean(body.removeGuest),
    });

    sendJson(payload.ok ? 200 : payload.statusCode || 400, payload);
  } catch (error) {
    recordApiError('workspace', 'workspace-claim-failed', error);
    sendJson(500, {
      error: errorMessage(error, 'Workspace claim failed.'),
    });
  }
}

export async function handleAiPortfolioSummaryRequest({
  method,
  workspaceId,
  readBody,
  clientKey,
  sendJson,
}) {
  if (method !== 'POST') {
    sendMethodNotAllowed(sendJson);
    return;
  }

  if (!enforceRateLimit('ai-portfolio-summary', clientKey, sendJson)) {
    return;
  }

  try {
    const body = await readBody();
    if (!isPlainObject(body)) {
      sendJson(400, { error: 'Request body must be a JSON object.' });
      return;
    }

    const { statusCode, payload } = await createPortfolioSummaryAnalysis({
      workspaceId,
      body,
    });
    sendJson(statusCode, payload);
  } catch (error) {
    recordApiError('ai', 'ai-portfolio-summary-failed', error, { workspaceId });
    sendJson(500, {
      error: errorMessage(error, 'AI portfolio summary failed.'),
    });
  }
}
