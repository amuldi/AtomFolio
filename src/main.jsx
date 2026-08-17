import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import { TermsOfService } from './legal/TermsOfService.jsx';
import { PrivacyPolicy } from './legal/PrivacyPolicy.jsx';
import { initAnalytics } from './lib/analytics.js';
import './styles.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

// No router in this app — for two static pages, adding react-router would be a heavier dependency
// than the problem calls for. Both / (and every other unmatched path — see vercel.json's SPA
// rewrite) already serve index.html; this just decides what to render for it, the same way the
// server-side rewrite already decides which HTML file to serve.
const path = typeof window !== 'undefined' ? window.location.pathname : '/';
const pageView =
  path === '/terms' ? (
    <TermsOfService />
  ) : path === '/privacy' ? (
    <PrivacyPolicy />
  ) : null;

// Without a publishable key, skip ClerkProvider entirely so local dev and builds without Clerk
// configured keep working in guest-only mode (App.jsx only renders AuthPanel when this same key
// is present, so its Clerk hooks never run without a surrounding provider).
const rootView = pageView ?? (
  clerkPublishableKey ? (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <App />
    </ClerkProvider>
  ) : (
    <App />
  )
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{rootView}</React.StrictMode>,
);

initAnalytics();

// See public/sw.js — installability only, deliberately does no offline caching of live market
// data. Skipped outside production builds so a stale dev-mode worker never survives a reload and
// shadows Vite's own dev server (a classic "why is my change not showing up" trap).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
