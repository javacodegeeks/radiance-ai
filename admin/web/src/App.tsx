import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton, OrganizationSwitcher, useAuth } from '@clerk/clerk-react';
import { ProductsPage } from './pages/ProductsPage';
import { AddProductPage } from './pages/AddProductPage';
import { SafetyDataPage } from './pages/SafetyDataPage';
import { SettingsPage } from './pages/SettingsPage';
import { DEV_BYPASS_AUTH } from './lib/devConfig';

function Shell({ devMode = false }: { devMode?: boolean }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Radiance AI — Admin Console</span>
        <nav>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/products/new">Add product</NavLink>
          <NavLink to="/safety-data">Safety data</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="app-header-right">
          {devMode ? (
            <span className="badge badge-warning" title="VITE_DEV_BYPASS_AUTH=true — Clerk is disabled">
              Auth bypassed (dev)
            </span>
          ) : (
            <>
              <OrganizationSwitcher hidePersonal />
              <UserButton />
            </>
          )}
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<AddProductPage />} />
          <Route path="/safety-data" element={<SafetyDataPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/products" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function SignedOutScreen() {
  return (
    <div className="signed-out">
      <h1>Radiance AI — Admin Console</h1>
      <p>Sign in with your staff account to continue.</p>
      <SignInButton mode="modal" />
    </div>
  );
}

/** Only rendered when Clerk is actually mounted (see main.tsx) — safe to call useAuth() etc. here. */
function ClerkGatedApp() {
  const { orgId } = useAuth();

  return (
    <>
      <SignedIn>
        {orgId ? <Shell /> : (
          <div className="signed-out">
            <h1>Select an organization</h1>
            <p>Your account isn't active in an organization yet — pick one to continue.</p>
            <OrganizationSwitcher hidePersonal />
          </div>
        )}
      </SignedIn>
      <SignedOut>
        <SignedOutScreen />
      </SignedOut>
    </>
  );
}

export function App() {
  // No ClerkProvider is mounted in this mode (see main.tsx) — go straight
  // to the console against admin/server's dev tenant, skip Clerk entirely.
  if (DEV_BYPASS_AUTH) {
    return <Shell devMode />;
  }
  return <ClerkGatedApp />;
}
