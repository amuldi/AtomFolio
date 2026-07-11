const DEFAULT_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10000;

// Shared across module reloads within one process/instance. On Vercel this is
// per serverless instance, so limits are best-effort there (see README).
const state = globalThis.__ATOMFOLIO_RATE_LIMIT_STATE__ ?? new Map();

globalThis.__ATOMFOLIO_RATE_LIMIT_STATE__ = state;

function pruneExpiredKeys(now, windowMs) {
  for (const [key, timestamps] of state) {
    if (!timestamps.length || timestamps[timestamps.length - 1] <= now - windowMs) {
      state.delete(key);
    }
  }
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

export function checkRateLimit({
  bucket,
  clientKey,
  limit,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now(),
}) {
  const key = `${bucket}:${clientKey || 'unknown'}`;
  const windowStart = now - windowMs;
  const timestamps = (state.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

  if (timestamps.length >= limit) {
    state.set(key, timestamps);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000)),
    };
  }

  timestamps.push(now);
  state.set(key, timestamps);

  if (state.size > MAX_TRACKED_KEYS) {
    pruneExpiredKeys(now, windowMs);
  }

  return {
    ok: true,
    remaining: limit - timestamps.length,
    retryAfterSeconds: 0,
  };
}

export function resetRateLimitState() {
  state.clear();
}
