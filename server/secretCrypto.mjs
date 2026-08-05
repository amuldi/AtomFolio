// Generic AES-256-GCM envelope for any secret that needs to sit in the database at rest — first
// consumer is broker credentials (KIS app key/secret, access token), but nothing here is
// KIS-specific. The encryption key itself never touches the database or the codebase: it's read
// once from an env var (ATOMFOLIO_BROKER_ENCRYPTION_KEY, base64-encoded, 32 raw bytes for
// AES-256) and kept only in process memory.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_ENV_VAR = 'ATOMFOLIO_BROKER_ENCRYPTION_KEY';

function getEncryptionKey() {
  const raw = String(process.env[KEY_ENV_VAR] ?? '').trim();

  if (!raw) {
    throw new Error(`${KEY_ENV_VAR} is not configured.`);
  }

  const key = Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(`${KEY_ENV_VAR} must decode to exactly 32 bytes for AES-256 (got ${key.length}).`);
  }

  return key;
}

export function isSecretEncryptionConfigured() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

// plaintextObject is JSON-serialized before encrypting, so any secret shape (a single string, or
// a bundle like { appKey, appSecret, accessToken }) can go through this unchanged. Returns a
// single Buffer: iv (12B) + authTag (16B) + ciphertext — one column, no separate iv/tag storage.
export function encryptSecret(plaintextObject) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObject), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]);
}

// Throws if the key is wrong or the blob was tampered with (GCM's auth tag check fails closed —
// there is no "decrypt anyway" path).
export function decryptSecret(blob) {
  const key = getEncryptionKey();
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);

  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted secret blob is too short to contain an iv and auth tag.');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(plaintext.toString('utf-8'));
}
