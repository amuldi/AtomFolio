// Centralizes the "is this deployment actually safe to run as a real financial-data service"
// check. Consumed by /api/health (so the answer is visible without shelling into Vercel function
// logs) and by server/portfolioStore.mjs's guest-workspace policy (see isAcceptableGuestWorkspaceId
// there for why production tightens what a bare guest:<id> is allowed to do).
//
// This module deliberately never throws and never blocks a request by itself — it only computes
// and reports. Whether a given warning/error should actually refuse a request is decided at the
// call site (see portfolioStore.mjs), so a bug in readiness detection can never itself become an
// outage.
import { getPortfolioStoreStatus } from './portfolioStore.mjs';
import { getRateLimitStatus } from './rateLimit.mjs';

// Same definition of "production" that server/workspaceAccess.mjs's shouldTrustAuthHeaders()
// already uses for the security-critical header-spoofing guard: VERCEL=1 (set by Vercel on every
// deployment, including preview) or NODE_ENV=production. Preview deployments intentionally get
// the same guardrails as production — they're still reachable from the public internet with real
// auth flows, not a safe place to relax checks.
export function isProductionEnvironment() {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

function isClerkSecretConfigured() {
  return Boolean(String(process.env.CLERK_SECRET_KEY ?? '').trim());
}

function isClerkPublishableConfigured() {
  // Vite only inlines VITE_-prefixed vars into the built client bundle, so this check is
  // best-effort from server-side code (it can't see what the deployed client bundle actually
  // shipped with). CLERK_SECRET_KEY is what actually gates whether the server can verify tokens
  // at all, so that one is treated as the load-bearing check; this one is an additional signal.
  return Boolean(
    String(process.env.VITE_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? '').trim(),
  );
}

function isBrokerEncryptionConfigured() {
  return Boolean(String(process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY ?? '').trim());
}

export function getProductionReadiness() {
  const production = isProductionEnvironment();
  const store = getPortfolioStoreStatus();
  const rateLimit = getRateLimitStatus();
  const clerkSecretConfigured = isClerkSecretConfigured();
  const clerkPublishableConfigured = isClerkPublishableConfigured();
  const brokerEncryptionConfigured = isBrokerEncryptionConfigured();

  const warnings = [];
  const errors = [];

  if (production && store.driver !== 'postgres') {
    // The single biggest risk this check can catch: without Postgres, every portfolio write lives
    // only in one serverless instance's process memory (or, off Vercel, a local JSON file) and can
    // vanish on the next cold start or redeploy. See docs/production-readiness.md.
    errors.push({
      code: 'store-driver-not-durable',
      message: `Portfolio store driver is "${store.driver}" in production — data is not durably persisted across cold starts/redeploys. Configure DATABASE_URL (Neon/Postgres).`,
    });
  }

  if (production && !clerkSecretConfigured) {
    errors.push({
      code: 'clerk-secret-missing',
      message:
        'CLERK_SECRET_KEY is not set in production — bearer tokens cannot be verified, so every request is treated as unauthenticated (guest-only).',
    });
  }

  if (production && !clerkPublishableConfigured) {
    warnings.push({
      code: 'clerk-publishable-missing',
      message:
        'VITE_CLERK_PUBLISHABLE_KEY does not appear to be configured — the client will not render the sign-in UI, so users cannot authenticate at all.',
    });
  }

  if (production && !brokerEncryptionConfigured) {
    warnings.push({
      code: 'broker-encryption-missing',
      message:
        'ATOMFOLIO_BROKER_ENCRYPTION_KEY is not set — broker credential linking fails closed (by design) until this is configured.',
    });
  }

  if (production && rateLimit.driver === 'memory') {
    warnings.push({
      code: 'rate-limit-not-durable',
      message:
        'Rate limiting uses the in-memory driver, which is best-effort per serverless instance in production. See docs/production-readiness.md for recommended values and the Redis driver extension point.',
    });
  }

  return {
    isProduction: production,
    clerk: {
      secretConfigured: clerkSecretConfigured,
      publishableConfigured: clerkPublishableConfigured,
    },
    database: {
      configured: store.driver === 'postgres',
      driver: store.driver,
    },
    rateLimit,
    brokerEncryptionConfigured,
    warnings,
    errors,
    // A short summary a human can read at a glance without walking warnings/errors — "green" only
    // when there are zero errors AND zero warnings, "warning" when only warnings are present,
    // "blocked" when at least one error is present. Non-production environments are always
    // "not-applicable" since none of these checks are meant to apply there.
    level: !production
      ? 'not-applicable'
      : errors.length > 0
        ? 'blocked'
        : warnings.length > 0
          ? 'warning'
          : 'ready',
  };
}
