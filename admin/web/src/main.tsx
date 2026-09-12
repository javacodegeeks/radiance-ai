import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import { DEV_BYPASS_AUTH } from './lib/devConfig';
import './index.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (DEV_BYPASS_AUTH) {
  console.warn('[main] VITE_DEV_BYPASS_AUTH=true — Clerk is disabled, running unauthenticated against the dev tenant. Never use this build in production.');
} else if (!clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — set it in admin/web/.env');
}

const routedApp = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {DEV_BYPASS_AUTH ? routedApp : (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        {routedApp}
      </ClerkProvider>
    )}
  </React.StrictMode>,
);
