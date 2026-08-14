// "Device tokens" let a non-browser client (currently: the macOS menu bar companion app, see
// desktop/) act as a specific authenticated user without running a full OAuth/Clerk flow —
// Electron doesn't have Clerk's hosted redirect flow, and this repo isn't taking that on right
// now. This extends, rather than replaces, the desktop app's existing "paste a workspace ID"
// connection model (desktop/src/lib/api.mjs): pasting a device token instead of a plain
// guest:<uuid> now works too, and resolves to the signed-in user's own workspace.
//
// A device token is a single long, random, opaque string — never a JWT, nothing about it needs to
// be decoded client-side, it's just a bearer credential. Only its SHA-256 hash is ever stored,
// mirroring the "don't keep a recoverable copy of the secret" principle secretCrypto.mjs follows
// for broker credentials (there via reversible encryption, since that secret has to be recovered
// later to call the broker's API; here via a one-way hash, since nothing ever needs the original
// token back — verifying just means re-hashing whatever the client presents and comparing).
//
// Postgres-only, matching this repo's broader stance that anything meant to survive across
// sessions/devices needs durable storage — a token issued while running on the file/memory
// fallback store would silently stop working on the next redeploy, worse than not offering the
// feature there at all (see docs/production-readiness.md).
import { randomBytes, createHash } from 'node:crypto';
import {
  createPostgresDeviceToken,
  isPostgresStoreEnabled,
  revokePostgresDeviceTokensForUser,
  verifyPostgresDeviceToken,
} from './postgresPortfolioStore.mjs';

const TOKEN_PREFIX = 'atomfolio_dt_';
const TOKEN_RANDOM_BYTES = 32;

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Cheap pre-filter so a plain guest:<uuid> or a garbage string never even reaches a database
// round trip — real device tokens always start with this prefix.
export function isDeviceTokenFormat(value) {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

export function isDeviceTokenStoreConfigured() {
  return isPostgresStoreEnabled();
}

// Regenerating replaces rather than adds — a user only ever has one live device token at a time,
// so "생성" (generate) doubles as "재발급" (reissue) in the UI. A simpler mental model than a list
// of named tokens, and it still gives real revocation (see revokeDeviceTokensForUser) without
// per-item management UI: losing a laptop means generating a fresh code, which immediately kills
// the old one.
export async function issueDeviceTokenForUser(userId) {
  if (!isPostgresStoreEnabled()) {
    throw new Error('Device tokens require a configured database (DATABASE_URL).');
  }

  await revokePostgresDeviceTokensForUser(userId);

  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_RANDOM_BYTES).toString('base64url')}`;
  await createPostgresDeviceToken(userId, hashToken(token));

  // The raw token is only ever returned here, at issue time — from this point on only its hash
  // exists anywhere on the server, so it can never be redisplayed if the user navigates away
  // before copying it. The API route surfacing this makes that one-time-reveal explicit to the UI.
  return token;
}

export async function verifyDeviceToken(token) {
  if (!isDeviceTokenFormat(token) || !isPostgresStoreEnabled()) {
    return null;
  }

  try {
    return await verifyPostgresDeviceToken(hashToken(token));
  } catch {
    return null;
  }
}

export async function revokeDeviceTokensForUser(userId) {
  if (!isPostgresStoreEnabled()) {
    return 0;
  }

  return revokePostgresDeviceTokensForUser(userId);
}
