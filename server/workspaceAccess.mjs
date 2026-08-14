import { verifyToken } from '@clerk/backend';

import {
  ensureWorkspaceAccess,
  resolveWorkspaceId,
} from './portfolioStore.mjs';
import { isDeviceTokenFormat, verifyDeviceToken } from './deviceTokens.mjs';

const TRUSTED_AUTH_HEADER_FLAG = 'ATOMFOLIO_TRUSTED_AUTH_HEADERS';
const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();

  if (!headers) {
    return '';
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(lowerName) ?? '';
  }

  return headers[name] ?? headers[lowerName] ?? '';
}

function cleanHeaderText(value, maxLength = 180) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function shouldTrustAuthHeaders() {
  // Header spoofing is only ever safe on a machine we control end-to-end. Vercel's production
  // runtime is reachable from the public internet, so this is force-disabled there regardless of
  // how the flag is set (a stray ATOMFOLIO_TRUSTED_AUTH_HEADERS=true in a prod env must not open
  // the door to impersonating any user).
  if (process.env.VERCEL === '1') {
    return false;
  }

  const flag = String(process.env[TRUSTED_AUTH_HEADER_FLAG] ?? '').trim().toLowerCase();

  if (flag === 'true' || flag === '1' || flag === 'yes') {
    return true;
  }

  if (flag === 'false' || flag === '0' || flag === 'no') {
    return false;
  }

  return process.env.NODE_ENV !== 'production';
}

function getBearerToken(headers) {
  const rawHeader = getHeader(headers, 'authorization') || getHeader(headers, 'Authorization');
  const match = BEARER_TOKEN_PATTERN.exec(String(rawHeader ?? '').trim());
  return match ? match[1].trim() : '';
}

// Clerk session tokens only guarantee `sub` (the user id) by default. Email/display name are
// only present if the Clerk dashboard's session token template is customized to include them;
// treat them as optional enrichment rather than something the backend can rely on.
async function verifyClerkSessionToken(token) {
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!token || !secretKey) {
    return null;
  }

  try {
    const claims = await verifyToken(token, { secretKey });
    const userId = cleanHeaderText(claims?.sub, 180);

    if (!userId) {
      return null;
    }

    return {
      id: userId,
      email: cleanHeaderText(claims?.email ?? claims?.email_address, 254) || '',
      displayName: cleanHeaderText(claims?.name ?? claims?.full_name, 180) || '',
      authProvider: 'clerk',
      authSubject: userId,
    };
  } catch {
    return null;
  }
}

// A Bearer token is either a Clerk session JWT (the browser) or an atomfolio_dt_-prefixed device
// token (the desktop app, see deviceTokens.mjs) — cheap to tell apart by prefix before doing any
// verification work, so this only ever does the one real check that applies.
async function verifyClerkOrDeviceToken(token) {
  if (isDeviceTokenFormat(token)) {
    const userId = await verifyDeviceToken(token);
    return userId
      ? {
          id: userId,
          email: '',
          displayName: '',
          authProvider: 'device-token',
          authSubject: userId,
        }
      : null;
  }

  return verifyClerkSessionToken(token);
}

function shouldAllowQueryWorkspaceId() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL !== '1' ||
    process.env.ATOMFOLIO_ALLOW_QUERY_WORKSPACE_ID === 'true'
  );
}

function hasExplicitWorkspaceId(requestOrValue) {
  const headers = requestOrValue?.headers ?? {};
  const headerWorkspaceId = cleanHeaderText(getHeader(headers, 'x-atomfolio-workspace-id'), 120);
  const queryWorkspaceId = shouldAllowQueryWorkspaceId()
    ? cleanHeaderText(requestOrValue?.query?.workspaceId, 120)
    : '';

  return Boolean(headerWorkspaceId || queryWorkspaceId);
}

export async function resolveAuthContext(requestOrValue, { verifyBearerToken = verifyClerkOrDeviceToken } = {}) {
  const headers = requestOrValue?.headers ?? {};
  const bearerToken = getBearerToken(headers);

  if (bearerToken) {
    const user = await verifyBearerToken(bearerToken);

    if (user) {
      return { trusted: true, user };
    }
  }

  if (!shouldTrustAuthHeaders()) {
    return {
      trusted: false,
      user: null,
    };
  }

  const userId = cleanHeaderText(getHeader(headers, 'x-atomfolio-user-id'), 120);

  if (!userId) {
    return {
      trusted: true,
      user: null,
    };
  }

  return {
    trusted: true,
    user: {
      id: userId,
      email: cleanHeaderText(getHeader(headers, 'x-atomfolio-user-email'), 254),
      displayName: cleanHeaderText(getHeader(headers, 'x-atomfolio-user-name'), 180),
      authProvider: cleanHeaderText(getHeader(headers, 'x-atomfolio-auth-provider'), 80) || 'trusted-header',
      authSubject: cleanHeaderText(getHeader(headers, 'x-atomfolio-auth-subject'), 180) || userId,
    },
  };
}

export async function resolveWorkspaceRequestContext(requestOrValue, { requiredRole = 'viewer' } = {}) {
  const authContext = await resolveAuthContext(requestOrValue);
  const workspaceId =
    authContext.user && !hasExplicitWorkspaceId(requestOrValue)
      ? `user:${authContext.user.id}`
      : resolveWorkspaceId(requestOrValue);
  const access = await ensureWorkspaceAccess(workspaceId, authContext.user, { requiredRole });

  return {
    ...access,
    authContext,
  };
}

export async function resolveWorkspaceSessionContext(requestOrValue) {
  const authContext = await resolveAuthContext(requestOrValue);
  const workspaceId =
    authContext.user && !hasExplicitWorkspaceId(requestOrValue)
      ? `user:${authContext.user.id}`
      : resolveWorkspaceId(requestOrValue);

  return {
    authenticated: Boolean(authContext.user),
    trusted: Boolean(authContext.trusted),
    workspaceId,
    user: authContext.user
      ? {
          id: authContext.user.id,
          email: authContext.user.email || null,
          displayName: authContext.user.displayName || null,
        }
      : null,
  };
}

export function sendWorkspaceAccessError(access, sendJson) {
  sendJson(access.statusCode || 403, {
    error: access.error || 'Workspace access denied.',
    code: access.code || 'workspace-access-denied',
    workspaceId: access.workspaceId,
  });
}
