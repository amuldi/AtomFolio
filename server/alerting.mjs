// Optional, free "total outage" notifier. Every call always records an operationalEvent (so it
// shows up in /api/health regardless of configuration); it additionally POSTs a plain
// Slack-compatible incoming-webhook payload when ATOMFOLIO_ALERT_WEBHOOK_URL is set. With no
// webhook configured this second part is a no-op — nothing here costs money or requires signing
// up for anything, it's just wiring for whoever wants a push notification instead of having to
// poll /api/health themselves.
//
// A per-code cooldown keeps a systemic outage (every ticker's live quote failing at once) from
// firing one webhook call per request — see ALERT_COOLDOWN_MS below. Cooldown state is
// globalThis-backed, same convention as marketDataCache.mjs/kisProvider.mjs, so a dev-server hot
// reload doesn't leak duplicate timers.
import { recordOperationalEvent } from './operationalEvents.mjs';

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

const lastAlertAt = globalThis.__ATOMFOLIO_ALERT_COOLDOWN__ ?? new Map();
globalThis.__ATOMFOLIO_ALERT_COOLDOWN__ = lastAlertAt;

function getWebhookUrl() {
  return String(process.env.ATOMFOLIO_ALERT_WEBHOOK_URL ?? '').trim();
}

async function deliverWebhook(webhookUrl, code, message) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `[AtomFolio] ${code}: ${message}` }),
    });
  } catch {
    // Best-effort — a failed alert delivery must never surface as a user-facing error, and must
    // never throw back into whatever caller triggered the alert in the first place.
  } finally {
    clearTimeout(timeoutId);
  }
}

export function notifyOperationalAlert({ code, message, metadata = {} } = {}) {
  recordOperationalEvent({ level: 'error', area: 'alert', code, message, metadata });

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return;
  }

  const now = Date.now();
  const last = lastAlertAt.get(code) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) {
    return;
  }
  lastAlertAt.set(code, now);

  // Fire-and-forget by design: alert delivery must never add latency to the request that
  // triggered it. deliverWebhook already swallows its own errors.
  deliverWebhook(webhookUrl, code, message);
}

// Exposed for tests, same reason resetKisTokenState/resetMarketDataCache are.
export function resetAlertCooldownState() {
  lastAlertAt.clear();
}
