# radiance-ai-admin-web

React/TypeScript admin console for Radiance AI staff (admins and pharmacists). Talks to `admin/server`'s API to manage the product catalog and browse EU CosIng / ingredient safety reference data.

## Stack

- React 18 + TypeScript
- Vite
- React Router
- Clerk (`@clerk/clerk-react`) — staff auth, Organizations = tenants

## Getting started

```bash
npm install
cp .env.example .env   # fill in VITE_CLERK_PUBLISHABLE_KEY and VITE_API_BASE_URL
npm run dev             # http://localhost:5173, proxies API calls to admin/server
```

Other scripts:

```bash
npm run build     # tsc -b && vite build
npm run preview   # preview a production build locally
npm run lint       # eslint src --ext .ts,.tsx
```

Requires `admin/server` running (see its README) — `VITE_API_BASE_URL` should point at it (default `http://localhost:4000`).

## Environment variables

See `.env.example` for the full list.

- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key. Required unless `VITE_DEV_BYPASS_AUTH=true`.
- `VITE_API_BASE_URL` — base URL of `admin/server` (default `http://localhost:4000`)
- `VITE_DEV_BYPASS_AUTH` — **local dev only.** When `true`, Clerk is skipped entirely (no `ClerkProvider` is mounted, no publishable key needed) and the app runs directly against `admin/server`'s dev tenant. Pair with `admin/server`'s `DEV_BYPASS_AUTH=true`. Never set this in production.

## Auth model

- Signed-out users see a sign-in screen (`SignInButton`).
- Signed-in users without an active Clerk Organization are prompted to pick one (`OrganizationSwitcher`) — the app has no concept of a personal (non-org) account.
- Once in an org, the Clerk org role (`admin` | `pharmacist`) determines which actions `admin/server` allows; this app doesn't duplicate that authorization logic client-side beyond hiding/showing UI.

## Pages

| Route | Description |
|---|---|
| `/products` | Search the product catalog. Tabs: **All products** (shared base catalog + this tenant's additions) and **New products** (this tenant's own additions only), each with pagination and an embedding-status badge per row (with a "Re-index" action when a product isn't indexed or failed to index). |
| `/products/new` | Add a new product (admin role only). |
| `/safety-data` | Read-only browser for EU CosIng / ingredient safety reference data — tabs for ingredients, CosIng functions, prohibited substances, restrictions, and safety rules. Each tab is a search + paginated table. |
| `/settings` | Tenant settings (register/view the caller's org's subdomain). |

## Project structure

```
src/
  pages/         Route-level components (one per page above)
  components/     Reusable UI (ProductList, PaginatedList, ProductForm, EmbeddingStatusBadge)
  lib/            apiClient (typed fetch wrapper, attaches Clerk bearer token) + devConfig
  types.ts        Shared request/response types, mirrors admin/server's raw field shapes
  index.css       Design tokens (CSS variables) + component styles
```

## Conventions

- `apiClient.ts` is the only place that calls `admin/server` — pages/components never `fetch()` directly.
- Types mirror `admin/server`'s raw snake_case Mongo/Postgres field names (e.g. `product_name`, `inci_name`) rather than camelCasing them, for consistency with how `admin/server` returns data.
- `PaginatedList<T>` is a generic search+paginate+table component shared by all five Safety Data tabs.
