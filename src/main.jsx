import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './styles.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

// Without a publishable key, skip ClerkProvider entirely so local dev and builds without Clerk
// configured keep working in guest-only mode (App.jsx only renders AuthPanel when this same key
// is present, so its Clerk hooks never run without a surrounding provider).
const rootView = clerkPublishableKey ? (
  <ClerkProvider publishableKey={clerkPublishableKey}>
    <App />
  </ClerkProvider>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{rootView}</React.StrictMode>,
);
