import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleHealthRequest,
  handleAiPortfolioSummaryRequest,
  handleMarketFinancialsRequest,
  handleMarketLiveRequest,
  handleMarketNewsRequest,
  handleMarketSearchRequest,
  handlePortfolioCollectionRequest,
  handlePortfolioImportsRequest,
  handlePortfolioIngestRequest,
  handlePortfolioItemRequest,
  handleSecurityEnrichRequest,
  handleWorkspaceClaimGuestRequest,
  handleWorkspaceSessionRequest,
} from './apiHandlers.mjs';
import {
  resolveAuthContext,
  resolveWorkspaceRequestContext,
  resolveWorkspaceSessionContext,
  sendWorkspaceAccessError,
} from './workspaceAccess.mjs';
import { resolveClientKey } from './rateLimit.mjs';

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

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
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

function getWorkspaceContextFromUrl(request, requestUrl, requiredRole) {
  return resolveWorkspaceRequestContext({
    headers: request.headers,
    query: {
      workspaceId: requestUrl.searchParams.get('workspaceId'),
    },
  }, { requiredRole });
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
  const sendApiJson = (statusCode, payload, headers) => sendJson(response, statusCode, payload, headers);
  const readBody = () => readJsonBody(request);
  const clientKey = resolveClientKey(request);

  if (requestUrl.pathname === '/api/health') {
    await handleHealthRequest({
      method: request.method,
      query: requestUrl.searchParams,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/market/live') {
    await handleMarketLiveRequest({
      method: request.method,
      query: requestUrl.searchParams,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/market/search') {
    await handleMarketSearchRequest({
      method: request.method,
      query: requestUrl.searchParams,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/market/financials') {
    await handleMarketFinancialsRequest({
      method: request.method,
      query: requestUrl.searchParams,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/market/news') {
    await handleMarketNewsRequest({
      method: request.method,
      query: requestUrl.searchParams,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/securities/enrich') {
    await handleSecurityEnrichRequest({
      method: request.method,
      readBody,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/workspace/session') {
    await handleWorkspaceSessionRequest({
      method: request.method,
      workspaceSession: await resolveWorkspaceSessionContext({
        headers: request.headers,
        query: {
          workspaceId: requestUrl.searchParams.get('workspaceId'),
        },
      }),
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/workspace/claim-guest') {
    await handleWorkspaceClaimGuestRequest({
      method: request.method,
      authContext: await resolveAuthContext({
        headers: request.headers,
      }),
      readBody,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/ai/portfolio-summary') {
    const workspaceContext = await getWorkspaceContextFromUrl(request, requestUrl, 'editor');

    if (!workspaceContext.ok) {
      sendWorkspaceAccessError(workspaceContext, sendApiJson);
      return;
    }

    await handleAiPortfolioSummaryRequest({
      method: request.method,
      workspaceId: workspaceContext.workspaceId,
      readBody,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/portfolio/ingest') {
    await handlePortfolioIngestRequest({
      method: request.method,
      readBody,
      clientKey,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/portfolio') {
    const workspaceContext = await getWorkspaceContextFromUrl(
      request,
      requestUrl,
      request.method === 'GET' ? 'viewer' : 'editor',
    );

    if (!workspaceContext.ok) {
      sendWorkspaceAccessError(workspaceContext, sendApiJson);
      return;
    }

    await handlePortfolioCollectionRequest({
      method: request.method,
      workspaceId: workspaceContext.workspaceId,
      readBody,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname === '/api/portfolio/imports') {
    const workspaceContext = await getWorkspaceContextFromUrl(
      request,
      requestUrl,
      request.method === 'GET' ? 'viewer' : 'editor',
    );

    if (!workspaceContext.ok) {
      sendWorkspaceAccessError(workspaceContext, sendApiJson);
      return;
    }

    await handlePortfolioImportsRequest({
      method: request.method,
      workspaceId: workspaceContext.workspaceId,
      readBody,
      sendJson: sendApiJson,
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/portfolio/')) {
    const workspaceContext = await getWorkspaceContextFromUrl(
      request,
      requestUrl,
      request.method === 'GET' ? 'viewer' : 'editor',
    );
    const portfolioId = decodeURIComponent(requestUrl.pathname.replace('/api/portfolio/', '')).trim();

    if (!workspaceContext.ok) {
      sendWorkspaceAccessError(workspaceContext, sendApiJson);
      return;
    }

    await handlePortfolioItemRequest({
      method: request.method,
      workspaceId: workspaceContext.workspaceId,
      portfolioId,
      readBody,
      sendJson: sendApiJson,
    });
    return;
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
