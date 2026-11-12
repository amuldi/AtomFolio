// storage.js issues plain fetch() calls outside of React, so it can't call Clerk's useAuth()
// hook directly. ClerkTokenBridge (mounted once at the app root, see main.jsx) registers the
// token getter here, and every outgoing request asks this module for a fresh Authorization header.
//
// The getter used to be registered by AuthPanel, which only mounts while the settings drawer is
// open — and its effect cleanup cleared the getter again on close. A signed-in user's saves then
// went out with no token and the server answered 401 ("서버 저장 실패").
const AUTH_RESOLVE_TIMEOUT_MS = 4000;

let tokenGetter = null;
let clerkEnabled = false;
let authResolved = false;
let resolveWaiters = [];

export function markClerkEnabled() {
  clerkEnabled = true;
}

// Called by ClerkTokenBridge whenever Clerk's auth state settles: `getter` is Clerk's getToken
// while signed in, null when signed out.
export function setClerkAuthState({ loaded, getter }) {
  tokenGetter = typeof getter === 'function' ? getter : null;
  if (loaded && !authResolved) {
    authResolved = true;
    const waiters = resolveWaiters;
    resolveWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

function waitForAuthResolution() {
  if (!clerkEnabled || authResolved) {
    return Promise.resolve();
  }
  // Requests fired during startup (initial load, first autosave) wait for Clerk to restore the
  // session instead of racing it and going out unauthenticated.
  return new Promise((resolve) => {
    resolveWaiters.push(resolve);
    setTimeout(resolve, AUTH_RESOLVE_TIMEOUT_MS);
  });
}

export async function getClerkAuthorizationHeader() {
  await waitForAuthResolution();

  if (!tokenGetter) {
    return null;
  }

  try {
    const token = await tokenGetter();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}
