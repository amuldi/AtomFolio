import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const originalStoreDriver = process.env.ATOMFOLIO_STORE_DRIVER;
const originalDatabaseUrl = process.env.DATABASE_URL;

// Force the non-Postgres path for this whole file — device tokens are Postgres-only by design
// (see server/deviceTokens.mjs's own comment), and these tests are specifically about that
// boundary plus the format check, not about real database round trips.
process.env.ATOMFOLIO_STORE_DRIVER = 'memory';
delete process.env.DATABASE_URL;

after(() => {
  if (originalStoreDriver == null) {
    delete process.env.ATOMFOLIO_STORE_DRIVER;
  } else {
    process.env.ATOMFOLIO_STORE_DRIVER = originalStoreDriver;
  }

  if (originalDatabaseUrl == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

const {
  isDeviceTokenFormat,
  isDeviceTokenStoreConfigured,
  issueDeviceTokenForUser,
  revokeDeviceTokensForUser,
  verifyDeviceToken,
} = await import('../server/deviceTokens.mjs');

test('isDeviceTokenFormat recognizes the atomfolio_dt_ prefix and rejects everything else', () => {
  assert.equal(isDeviceTokenFormat(`atomfolio_dt_${'a'.repeat(32)}`), true);
  assert.equal(isDeviceTokenFormat('guest:3fa85f64-5717-4562-b3fc-2c963f66afa6'), false);
  assert.equal(isDeviceTokenFormat('atomfolio_dt_short'), false);
  assert.equal(isDeviceTokenFormat(''), false);
  assert.equal(isDeviceTokenFormat(null), false);
  assert.equal(isDeviceTokenFormat(undefined), false);
});

test('device tokens are reported as unconfigured without a Postgres driver', () => {
  assert.equal(isDeviceTokenStoreConfigured(), false);
});

test('issueDeviceTokenForUser refuses to run without a configured database', async () => {
  await assert.rejects(issueDeviceTokenForUser('user-1'), /database/i);
});

test('verifyDeviceToken returns null for a non-device-token string without touching the database', async () => {
  assert.equal(await verifyDeviceToken('guest:not-a-device-token'), null);
  assert.equal(await verifyDeviceToken(''), null);
});

test('revokeDeviceTokensForUser is a safe no-op without a configured database', async () => {
  assert.equal(await revokeDeviceTokensForUser('user-1'), 0);
});
