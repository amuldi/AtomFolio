import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestPortfolioText } from './portfolioIngestion.mjs';
import {
  enrichSecurityIdentifiers,
  enrichSecurityItems,
  getSecurityEnrichmentCacheStats,
} from './securityEnrichment.mjs';
import {
  fetchLiveMarketDataFromProviders,
  searchMarketSymbolSuggestions,
} from '../src/lib/liveMarketData.js';
import { fetchMarketNewsFromProviders } from '../src/lib/marketNews.js';
import {
  createPortfolio,
  deletePortfolio,
  getPortfolio,
  getPortfolioStoreStatus,
  listImportHistory,
  listPortfolios,
  resolveWorkspaceId,
  saveImportHistory,
  updatePortfolio,
} from './portfolioStore.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const shouldServeStatic = process.argv.includes('--static');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const MAX_BODY_SIZE = 8 * 1024 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    request.on('error', reject);
  });
}

function getWorkspaceIdFromUrl(request, requestUrl) {
  return resolveWorkspaceId({
    headers: request.headers,
    query: {
      workspaceId: requestUrl.searchParams.get('workspaceId'),
    },
  });
}

async function serveStaticAsset(requestPath, response) {
  if (!shouldServeStatic || !existsSync(distRoot)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  const decodedPath = decodeURIComponent(requestPath.split('?')[0]);
  const sanitizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  let assetPath = path.join(distRoot, sanitizedPath === '/' ? 'index.html' : sanitizedPath);

  if (!assetPath.startsWith(distRoot)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  if (!existsSync(assetPath) || sanitizedPath === '/') {
    assetPath = path.join(distRoot, 'index.html');
  }

  try {
    const extension = path.extname(assetPath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    });
    createReadStream(assetPath).pipe(response);
  } catch {
    sendJson(response, 500, { error: 'Failed to serve asset.' });
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      portfolioStore: getPortfolioStoreStatus(),
      securityEnrichment: getSecurityEnrichmentCacheStats(),
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/market/live') {
    try {
      const ticker = requestUrl.searchParams.get('ticker') ?? '';
      const name = requestUrl.searchParams.get('name') ?? '';

      if (!ticker.trim() && !name.trim()) {
        sendJson(response, 400, { error: 'Provide ticker or name.' });
        return;
      }

      const payload = await fetchLiveMarketDataFromProviders({ ticker, name });
      sendJson(response, 200, payload);
      return;
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : 'Market data fetch failed.',
      });
      return;
    }
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/market/search') {
    try {
      const query = String(
        requestUrl.searchParams.get('query') ?? requestUrl.searchParams.get('q') ?? '',
      ).trim();
      const limit = Math.min(12, Math.max(1, Number(requestUrl.searchParams.get('limit') ?? 10) || 10));

      if (query.length < 2 && !/[가-힣]/.test(query)) {
        sendJson(response, 200, { suggestions: [] });
        return;
      }

      const suggestions = await searchMarketSymbolSuggestions(query, { limit });
      sendJson(response, 200, { suggestions });
      return;
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : 'Market search failed.',
      });
      return;
    }
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/market/news') {
    try {
      const query = String(requestUrl.searchParams.get('query') ?? '').trim().slice(0, 80);
      const tickers = String(requestUrl.searchParams.get('tickers') ?? '')
        .split(',')
        .map((ticker) => ticker.trim().slice(0, 18))
        .filter(Boolean)
        .slice(0, 5);
      const language = requestUrl.searchParams.get('language') === 'en' ? 'en' : 'ko';
      const mode = requestUrl.searchParams.get('mode') === 'search' ? 'search' : 'today';
      const refreshKey = String(
        requestUrl.searchParams.get('_ts') ?? requestUrl.searchParams.get('refresh') ?? '',
      ).trim().slice(0, 32);
      const payload = await fetchMarketNewsFromProviders({ query, tickers, language, mode, refreshKey });

      sendJson(response, 200, payload);
      return;
    } catch (error) {
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : 'Market news fetch failed.',
      });
      return;
    }
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/securities/enrich') {
    try {
      const body = await readJsonBody(request);
      const force = Boolean(body.force);

      if (Array.isArray(body.items)) {
        const payload = await enrichSecurityItems(body.items, { force });
        sendJson(response, 200, payload);
        return;
      }

      if (Array.isArray(body.identifiers)) {
        const payload = await enrichSecurityIdentifiers(body.identifiers, { force });
        sendJson(response, 200, payload);
        return;
      }

      sendJson(response, 400, {
        error: 'Provide an items array or identifiers array.',
      });
      return;
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Security enrichment failed.',
      });
      return;
    }
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/portfolio/ingest') {
    try {
      const body = await readJsonBody(request);
      const fileName = String(body.fileName ?? '').trim() || 'portfolio.csv';
      const text = String(body.text ?? '');

      if (!text.trim()) {
        sendJson(response, 400, { error: 'Upload text is empty.' });
        return;
      }

      const payload = await ingestPortfolioText(fileName, text);
      sendJson(response, 200, payload);
      return;
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Portfolio ingestion failed.',
      });
      return;
    }
  }

  if (requestUrl.pathname === '/api/portfolio') {
    const workspaceId = getWorkspaceIdFromUrl(request, requestUrl);

    try {
      if (request.method === 'GET') {
        sendJson(response, 200, await listPortfolios(workspaceId));
        return;
      }

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        sendJson(response, 201, await createPortfolio(workspaceId, body));
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Portfolio API failed.',
      });
      return;
    }
  }

  if (requestUrl.pathname === '/api/portfolio/imports') {
    const workspaceId = getWorkspaceIdFromUrl(request, requestUrl);

    try {
      if (request.method === 'GET') {
        sendJson(response, 200, await listImportHistory(workspaceId));
        return;
      }

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        sendJson(response, 201, await saveImportHistory(workspaceId, body));
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Import history API failed.',
      });
      return;
    }
  }

  if (requestUrl.pathname.startsWith('/api/portfolio/')) {
    const workspaceId = getWorkspaceIdFromUrl(request, requestUrl);
    const portfolioId = decodeURIComponent(requestUrl.pathname.replace('/api/portfolio/', '')).trim();

    if (!portfolioId) {
      sendJson(response, 400, { error: 'Portfolio id is required.' });
      return;
    }

    try {
      if (request.method === 'GET') {
        const portfolio = await getPortfolio(workspaceId, portfolioId);
        if (!portfolio) {
          sendJson(response, 404, { error: 'Portfolio not found.' });
          return;
        }

        sendJson(response, 200, { workspaceId, portfolio });
        return;
      }

      if (request.method === 'PUT' || request.method === 'PATCH') {
        const body = await readJsonBody(request);
        const payload = await updatePortfolio(workspaceId, portfolioId, body);
        if (!payload) {
          sendJson(response, 404, { error: 'Portfolio not found.' });
          return;
        }

        sendJson(response, 200, payload);
        return;
      }

      if (request.method === 'DELETE') {
        const deleted = await deletePortfolio(workspaceId, portfolioId);
        if (!deleted) {
          sendJson(response, 404, { error: 'Portfolio not found.' });
          return;
        }

        sendJson(response, 200, { workspaceId, deleted: true, id: portfolioId });
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Portfolio API failed.',
      });
      return;
    }
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    await serveStaticAsset(requestUrl.pathname, response);
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed.' });
});

server.listen(port, host, () => {
  const mode = shouldServeStatic ? 'api+static' : 'api';
  console.log(`[atomfolio-backend] listening on http://${host}:${port} (${mode})`);
});
