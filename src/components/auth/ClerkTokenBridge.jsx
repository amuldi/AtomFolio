import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setClerkAuthState } from '../../lib/clerkAuthBridge.js';

// Always mounted inside ClerkProvider (main.jsx), independent of which panel is open, so every
// API request can attach the signed-in user's token. Renders nothing.
export function ClerkTokenBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    setClerkAuthState({ loaded: isLoaded, getter: isLoaded && isSignedIn ? getToken : null });
  }, [isLoaded, isSignedIn, getToken]);

  return null;
}
