# radiance-ai-admin-server

Express/TypeScript API backing the Radiance AI admin console (`admin/web`). Lets staff (admins and pharmacists) manage the product catalog and browse EU CosIng / ingredient safety reference data.

This package is independent from `ai/` and `data/` — it does not import from either. It talks directly to the same shared MongoDB, Qdrant, and Postgres instances those packages use, with its own infra clients and error types.

## Stack

- Express 4 + TypeScript
- MongoDB (`obf`/products db) — product catalog, shared with `ai/`
- Qdrant — product embeddings, shared with `ai/`
- PostgreSQL (`cosmetic_rai` db) — EU CosIng / ingredient safety tables, read-only, seeded by `data/pipeline`
- Clerk (`@clerk/express`) — staff auth; Clerk Organizations map to tenants, org role maps to `admin` | `pharmacist`

## Getting started

```bash
npm install
cp .env.example .env   # fill in Mongo/Qdrant/Postgres/Clerk credentials
npm run dev             # ts-node-dev, http://localhost:4000
```

Other scripts:

```bash
npm run build   # tsc -> dist/
npm run lint     # eslint src --ext .ts
```

## Environment variables

See `.env.example` for the full list. Key groups:

- `PORT` — server port (default 4000)
- `MONGO_*` — shared Mongo cluster connection
- `QDRANT_URL` — shared Qdrant instance
- `DB_*` — shared Postgres (`cosmetic_rai`) connection; **read-only** from this package
- `EMBEDDING_MODEL`, `LITELLM_BASE_URL`, `LITELLM_API_KEY` — embedding generation via the same LiteLLM proxy `ai/`/`data/pipeline` use
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` — staff auth
- `DEV_BYPASS_AUTH`, `DEV_TENANT_ID`, `DEV_USER_ID` — **local dev only.** When `DEV_BYPASS_AUTH=true`, Clerk is skipped entirely and every request is treated as an authenticated staff member of `DEV_TENANT_ID`. Pair with `admin/web`'s `VITE_DEV_BYPASS_AUTH=true`. Never set this outside local development.

## Auth model

`src/middleware/auth.ts` resolves `tenantId` from the caller's active Clerk Organization (`orgId`) — never from a request body/query field, so one tenant's admin can never write into another tenant's data.

- `requireAnyStaffRole()` — any authenticated staff member (admin or pharmacist). Used by read endpoints both roles need.
- `requireRole('admin')` — admin org role only. Used by writes (adding/reindexing products, registering a tenant).

## API

All routes are mounted under `/api` and require staff auth (see above) unless noted.

### Products

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/products?q=&page=&limit=&mine=` | any staff | Search the shared base catalog + this tenant's additions. `mine=true` restricts to only this tenant's own additions (powers the "New products" tab in admin/web). `limit` capped at 100. |
| `POST` | `/products` | admin | Add a product: inserts into Mongo, then embeds and upserts into Qdrant. Fails loudly if either step fails. |
| `GET` | `/products/:id/embedding` | any staff | Look up a product's Qdrant indexing status (`indexed: boolean`, optional payload/vector). |
| `POST` | `/products/:id/reindex` | admin | Re-embed a product from its current Mongo fields and re-upsert into Qdrant (repair/retry for "Not indexed" or failed products). |

Product `_id` may be either a Mongo `ObjectId` (admin-added docs) or a raw string barcode (base-catalog OBF/OFF-imported docs) — both are handled transparently.

### Safety data (read-only, EU CosIng / ingredient reference data)

| Method | Path | Role |
|---|---|---|
| `GET` | `/ingredients?q=&page=&limit=` | any staff |
| `GET` | `/cosing/functions?q=&page=&limit=` | any staff |
| `GET` | `/cosing/prohibited-substances?q=&page=&limit=` | any staff |
| `GET` | `/cosing/restrictions?q=&page=&limit=` | any staff |
| `GET` | `/safety-rules?q=&page=&limit=` | any staff |

All return `{ items, total, page, limit }`. Backed by Postgres tables seeded by `data/pipeline`; never written to from this package.

### Tenants

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/tenants` | admin | Register the caller's org's subdomain/name. |
| `GET` | `/tenants/me` | admin | Look up the caller's org's tenant record. |

### Health

`GET /health` — unauthenticated, returns `{ ok: true, service: 'radiance-ai-admin-server' }`.

## Project structure

```
src/
  controllers/   Express routers — HTTP layer only (validation, status codes)
  services/      Business logic that spans multiple repositories/infra clients
  repositories/   Data access for one collection/table family
  infra/          Lazy-singleton Mongo/Qdrant/Postgres clients
  middleware/     Clerk-backed auth + role/tenant resolution
  common/         Shared error types (RepositoryError)
```
