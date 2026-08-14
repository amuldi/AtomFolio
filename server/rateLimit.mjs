// Rate limiting is driver-based so today's in-memory implementation can later be swapped for a
// shared store (e.g. Upstash Redis) without touching any call site — server/apiHandlers.mjs only
// ever calls checkRateLimit/resolveClientKey/resetRateLimitState, never the driver directly.
//
// Only the memory driver actually limits anything right now. See docs/production-readiness.md for
// why that's unsafe as the *sole* defense in a multi-instance production deployment, and what
// "recommended production values" means in practice.
const DEFAULT_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10000;

// ---- memory driver (default) ---------------------------------------------------------------
// Shared across module reloads within one process/instance. On Vercel this is per serverless
// instance, so limits are best-effort there: concurrent cold instances each keep their own
// counter, so the *effective* global limit across all instances can run higher than `limit`
// suggests. Fine as an abuse deterrent; not a durable/global guarantee — don't rely on it alone
// for anything that needs an exact cap (e.g. paid upstream API cost control).
const memoryState = globalThis.__ATOMFOLIO_RATE_LIMIT_STATE__ ?? new Map();
globalThis.__ATOMFOLIO_RATE_LIMIT_STATE__ = memoryState;

function pruneExpiredKeys(now, windowMs) {
  for (const [key, timestamps] of memoryState) {
    if (!timestamps.length || timestamps[timestamps.length - 1] <= now - windowMs) {
      memoryState.delete(key);
    }
  }
}

function memoryCheckRateLimit({ bucket, clientKey, limit, windowMs = DEFAULT_WINDOW_MS, now = Date.now() }) {
  const key = `${bucket}:${clientKey || 'unknown'}`;
  const windowStart = now - windowMs;
  const timestamps = (memoryState.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

  if (timestamps.length >= limit) {
    memoryState.set(key, timestamps);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000)),
    };
  }

  timestamps.push(now);
  memoryState.set(key, timestamps);

  if (memoryState.size > MAX_TRACKED_KEYS) {
    pruneExpiredKeys(now, windowMs);
  }

  return {
    ok: true,
    remaining: limit - timestamps.length,
    retryAfterSeconds: 0,
  };
}

const memoryDriver = {
  name: 'memory',
  durable: false,
  configured: true, // always "available" — it's the zero-config default
  checkRateLimit: memoryCheckRateLimit,
  reset: () => memoryState.clear(),
};

// ---- redis driver (extension point, not wired to a client) ---------------------------------
// This repo deliberately does not add an external Redis/Upstash dependency. Selecting
// ATOMFOLIO_RATE_LIMIT_DRIVER=redis without also configuring a connection (ATOMFOLIO_REDIS_URL,
// or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) logs a one-time warning and runs on the
// memory driver's behavior underneath — a misconfigured rate limiter should never be the reason
// requests start failing. To make this real: implement checkRateLimit here against Upstash's
// REST API (INCR + PEXPIRE, or a Lua sliding-window script) and flip `configured`/`durable` to
// true once the env vars are present.
function isRedisConfigured() {
  return Boolean(
    process.env.ATOMFOLIO_REDIS_URL ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

let redisFallbackWarned = false;

function createRedisDriver() {
  const configured = isRedisConfigured();

  if (!configured && !redisFallbackWarned) {
    redisFallbackWarned = true;
    console.warn(
      '[atomfolio] ATOMFOLIO_RATE_LIMIT_DRIVER=redis is set but no Redis/Upstash connection is ' +
        'configured (ATOMFOLIO_REDIS_URL or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN). ' +
        'Falling back to in-memory rate limiting, which is best-effort only across multiple ' +
        'serverless instances. See docs/production-readiness.md.',
    );
  }

  return {
    name: 'redis',
    // Even when "configured" (env vars present), this driver isn't actually backed by Redis yet
    // — see the comment above. durable stays false until a real client is implemented here.
    durable: false,
    configured,
    checkRateLimit: memoryCheckRateLimit,
    reset: () => memoryState.clear(),
  };
}

function resolveDriverName() {
  return String(process.env.ATOMFOLIO_RATE_LIMIT_DRIVER ?? 'memory').trim().toLowerCase() || 'memory';
}

function getDriver() {
  return resolveDriverName() === 'redis' ? createRedisDriver() : memoryDriver;
}

export function checkRateLimit(args) {
  return getDriver().checkRateLimit(args);
}

export function resolveClientKey(request) {
  const headers = request?.headers ?? {};
  const forwardedFor = String(headers['x-forwarded-for'] ?? '').split(',')[0].trim();

  if (forwardedFor) {
    return forwardedFor;
  }

  const realIp = String(headers['x-real-ip'] ?? '').trim();
  if (realIp) {
    return realIp;
  }

  return String(request?.socket?.remoteAddress ?? '').trim() || 'unknown';
}

export function resetRateLimitState() {
  getDriver().reset();
}

// Consumed by server/productionReadiness.mjs and /api/health — always a stable shape so a
// rate-limit misconfiguration can never take the health check down with it.
export function getRateLimitStatus() {
  const driver = getDriver();
  return { driver: driver.name, durable: driver.durable, configured: driver.configured };
}
