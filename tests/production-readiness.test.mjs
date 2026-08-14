import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

const ENV_KEYS = [
  'NODE_ENV',
  'VERCEL',
  'CLERK_SECRET_KEY',
  'VITE_CLERK_PUBLISHABLE_KEY',
  'ATOMFOLIO_BROKER_ENCRYPTION_KEY',
  'ATOMFOLIO_STORE_DRIVER',
  'DATABASE_URL',
  'ATOMFOLIO_RATE_LIMIT_DRIVER',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

after(restoreEnv);

// server/portfolioStore.mjs decides its non-Postgres fallback driver ("file" vs "memory") once,
// at module import time, from whatever env is present then — it does not re-check per call (only
// the Postgres-enabled path is re-evaluated live, from DATABASE_URL/ATOMFOLIO_STORE_DRIVER, on
// every call). So ATOMFOLIO_STORE_DRIVER has to be set to "memory" *before* the import below,
// same reason tests/workspace-access.test.mjs does this — setting it inside an individual test
// body would be too late to affect the frozen fallback driver.
process.env.ATOMFOLIO_STORE_DRIVER = 'memory';
delete process.env.VERCEL;
process.env.NODE_ENV = 'test';

const { getProductionReadiness, isProductionEnvironment } = await import(
  '../server/productionReadiness.mjs'
);
const { resetRateLimitState } = await import('../server/rateLimit.mjs');

beforeEach(() => {
  restoreEnv();
  resetRateLimitState();
});

test('isProductionEnvironment is true on Vercel regardless of NODE_ENV', () => {
  process.env.VERCEL = '1';
  delete process.env.NODE_ENV;
  assert.equal(isProductionEnvironment(), true);
});

test('isProductionEnvironment is false in local/dev/test', () => {
  delete process.env.VERCEL;
  process.env.NODE_ENV = 'test';
  assert.equal(isProductionEnvironment(), false);
});

test('non-production readiness reports no errors/warnings regardless of missing env', () => {
  delete process.env.VERCEL;
  process.env.NODE_ENV = 'test';
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.DATABASE_URL;
  process.env.ATOMFOLIO_STORE_DRIVER = 'memory';

  const readiness = getProductionReadiness();

  assert.equal(readiness.isProduction, false);
  assert.equal(readiness.level, 'not-applicable');
  assert.deepEqual(readiness.errors, []);
});

test('production without CLERK_SECRET_KEY or a Postgres driver reports blocking errors', () => {
  process.env.VERCEL = '1';
  delete process.env.CLERK_SECRET_KEY;
  process.env.ATOMFOLIO_STORE_DRIVER = 'memory';
  delete process.env.DATABASE_URL;

  const readiness = getProductionReadiness();

  assert.equal(readiness.isProduction, true);
  assert.equal(readiness.level, 'blocked');
  assert.equal(readiness.clerk.secretConfigured, false);
  assert.equal(readiness.database.configured, false);
  assert.equal(readiness.database.driver, 'memory');
  assert.ok(readiness.errors.some((entry) => entry.code === 'clerk-secret-missing'));
  assert.ok(readiness.errors.some((entry) => entry.code === 'store-driver-not-durable'));
});

test('production with the memory rate limit driver reports a warning, not a blocking error', () => {
  process.env.VERCEL = '1';
  process.env.CLERK_SECRET_KEY = 'sk_test_present';
  process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_present';
  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = 'present';
  // Force postgres off so the store driver itself isn't the thing under test here.
  process.env.ATOMFOLIO_STORE_DRIVER = 'memory';
  delete process.env.DATABASE_URL;
  delete process.env.ATOMFOLIO_RATE_LIMIT_DRIVER;

  const readiness = getProductionReadiness();

  assert.ok(readiness.warnings.some((entry) => entry.code === 'rate-limit-not-durable'));
  assert.equal(readiness.rateLimit.driver, 'memory');
});

test('readiness is fully green only once every required piece is configured', () => {
  process.env.VERCEL = '1';
  process.env.CLERK_SECRET_KEY = 'sk_test_present';
  process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_present';
  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = 'present';
  process.env.ATOMFOLIO_STORE_DRIVER = 'postgres';
  process.env.DATABASE_URL = 'postgres://user:pass@host/db';

  const readiness = getProductionReadiness();

  assert.deepEqual(readiness.errors, []);
});
