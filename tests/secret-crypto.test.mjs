import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const { encryptSecret, decryptSecret, isSecretEncryptionConfigured } = await import(
  '../server/secretCrypto.mjs'
);

test('encryptSecret/decryptSecret round-trips a secret bundle', () => {
  const secret = { appKey: 'kis-app-key', appSecret: 'kis-app-secret', accessToken: null };
  const blob = encryptSecret(secret);

  assert.ok(Buffer.isBuffer(blob));
  assert.deepEqual(decryptSecret(blob), secret);
});

test('decryptSecret rejects a blob encrypted under a different key', () => {
  const blob = encryptSecret({ appKey: 'a' });
  const originalKey = process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY;
  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  assert.throws(() => decryptSecret(blob));

  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = originalKey;
});

test('decryptSecret rejects a tampered ciphertext (GCM auth tag fails closed)', () => {
  const blob = encryptSecret({ appKey: 'a' });
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff;

  assert.throws(() => decryptSecret(tampered));
});

test('isSecretEncryptionConfigured reflects whether the key env var is usable', () => {
  const originalKey = process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY;

  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  assert.equal(isSecretEncryptionConfigured(), true);

  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = 'too-short';
  assert.equal(isSecretEncryptionConfigured(), false);

  delete process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY;
  assert.equal(isSecretEncryptionConfigured(), false);

  process.env.ATOMFOLIO_BROKER_ENCRYPTION_KEY = originalKey;
});
