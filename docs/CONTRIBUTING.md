# Contributing to Radiance AI

Thanks for contributing. This doc covers the project-specific conventions — for architecture and setup, start with [README.md](../README.md), [architecture-overview.md](architecture-overview.md), and [file-map.md](file-map.md).

---

## Before you start

1. Read [file-map.md](file-map.md) — specifically the **"Dangerous files — coordinate before modifying"** tables for `ai/` and `data/`. This is a safety-checking application; a routing bug in the Supervisor or a loosened threshold in the Safety Checker has real user-facing consequences, not just a broken test.
2. Set up local infra and both packages per the README's [Infrastructure Setup](../README.md#infrastructure-setup), [Data Pipeline](../README.md#data-pipeline), and [Runtime API Server](../README.md#runtime-api-server) sections before making changes.

---

## Repository layout

Two independently-installed, independently-tested TypeScript packages, plus static docs/site content:

| Path | What it is |
|------|-----------|
| `ai/` | Runtime Express API — the LangGraph agent workflow, HTTP controllers, repositories. |
| `data/` | Offline pipeline — migrations, safety/CosIng data seeding, OBF catalog load, vectorization, category classification. |
| `docker/` | Local dev infra (`docker-compose.yml`) + LiteLLM model routing config. |
| `docs/` | Architecture overview and annotated file map. |
| `site/` | Static GitHub Pages landing page — marketing copy only, no application logic. |

**Package isolation is enforced, not just conventional.** Each package's `tsconfig.json` sets `rootDir` to itself, so `ai/` cannot import from `data/` (or vice versa) — the compiler will reject it. If you find yourself wanting to share code between them, duplicate the small amount needed rather than reaching across the boundary.

There is no root-level `package.json`. Every `npm install`/`npm run <script>` is run from inside `ai/` or `data/`.

---

## Branching and commits

- **Open pull requests against `dev`, not `main`.** `main` is not the PR target branch in this repo's CI (`.github/workflows/pr-tests.yml` triggers on PRs into `dev`).
- **Commit style** follows Conventional Commits, scoped to the package you touched: `type(scope): summary`, e.g.:
  - `feat(ai): add multi-stage Dockerfile for production builds`
  - `fix(ai): ground interactionWarnings in real ingredient data instead of LLM output`
  - `feat(data): add CosIng Functions enrichment schema and pipeline loader`
  - `docs(site): add public GitHub Pages landing page`
  - `test(ai): add coverage for graph/runner.ts`
  - `refactor(data): split CosIng seed data`
  - `ci(data): add manual workflow to run pipeline steps against SaaS databases`
- Common `type`s in this repo's history: `feat`, `fix`, `refactor`, `test`, `docs`, `ci`. Common `scope`s: `ai`, `data`, `site`.
- Keep commits scoped to one package where possible — cross-cutting changes are rare given the isolation above.

---

## Before opening a PR

Run these from inside the package(s) you changed (`ai/` and/or `data/`):

```bash
npm run lint    # ESLint — not yet enforced in CI (see below), but run it anyway
npm run test    # Jest — enforced in CI for both packages
```

**CI status, as currently configured** (`.github/workflows/`):
- `pr-tests.yml` runs `reusable-test.yml` for both `ai` and `data` on every PR into `dev` — **this must pass**.
- The lint jobs in `pr-tests.yml` are currently commented out. Run `npm run lint` locally anyway; don't rely on CI to catch style/type issues.
- `pr-approval-check.yml` (require ≥1 review approval) is currently commented out as a workflow but `.github/CODEOWNERS` still applies at the GitHub UI level — PRs touching `/ai/`, `/data/`, `/docker/`, or `/.github/` will request review from the relevant owners listed there.

---

## Writing tests

Tests live in `ai/tests/` and `data/tests/`, mirroring the `src/`/`pipeline/` directory structure one-to-one (e.g. `ai/src/agents/recommender.ts` → `ai/tests/agents/recommender.test.ts`). Follow the existing pattern in a neighboring test file rather than inventing a new one:

- **Mock at the module boundary**, not internals: `jest.mock('../../src/repositories/xRepository', () => ({ ... }))` at the top of the file, before imports. See `ai/tests/agents/safetyChecker.test.ts` or `ai/tests/repositories/feedbackRepository.test.ts`.
- **Repository tests** mock `infra/db` (Postgres, sync `getDb()`) or `infra/mongo` (Mongo, async `getDb()`) — check which one the repository under test actually imports; they have different call shapes.
- **Agent tests** mock `llm/client`'s `chatCompletion`/`stripJsonFences` and build a full `GraphStateType` fixture via a local `makeState()` helper rather than casting a partial object — the state shape is large enough that a typo in a partial cast fails silently instead of at compile time.
- **Controller tests** have no `supertest` dependency in this repo — pull the route handler directly off the Express `Router`'s internal `.stack` and invoke it with a fake `Request`/`Response` (see `ai/tests/controllers/feedbackController.test.ts` or `chatController.test.ts` for the exact pattern, including how the SSE controller test parses raw `event:`/`data:` frames out of `res.write()` calls).
- **Assert the specific safety invariant, not just the happy path.** For anything touching `safetyChecker.ts` or `recommender.ts`, prefer a test name that states the invariant (e.g. *"Layer 2 structurally cannot escalate a product to hard_block"*) over a generic "works correctly" test — these invariants are the actual product requirement, not incidental behavior.

Run a single file while iterating: `npx jest tests/agents/safetyChecker.test.ts`.

---

## Making common changes safely

- **Adding/changing a prompt** (`ai/src/llm/prompts.ts`): test against the actual `LLM_MODEL` configured in your `ai/.env`, not just a large hosted model. The default local dev model (`gemma-4-local`) is far less forgiving of prompt wording changes that affect JSON-mode compliance.
- **Changing `ai/src/graph/state.ts` reducers**: run the full graph-level tests (`ai/tests/graph/runner.test.ts`) after, not just the agent you meant to change — a reducer change silently affects how every agent's partial return is merged.
- **Changing `ai/src/agents/supervisor.ts` routing**: trace at least one multi-turn conversation manually in addition to unit tests. A routing bug here can silently skip the safety check or loop until the `MAX_ITERATIONS` cap.
- **Adding a `data/migrations/*.sql` file**: always add a new numbered file; never edit one that's already been applied to a running database — existing migrations use `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` so they're safe to re-run, but editing history diverges silently from what's actually in Postgres.
- **Raising an LLM preset's `max_tokens`** (`ai/src/llm/client.ts`): if you see `finish_reason === 'length'` in logs, raise the preset's budget rather than shrinking the prompt/schema — this has caused truncated-JSON production incidents before (see git history around `6f594a6`, `242de6d`).
- **Adding a CosIng ingredient function** to `ai/src/repositories/cosingFunctionsRepository.ts`'s `COSING_FUNCTION_NAMES`: add the matching row to the migration/seed step first, then confirm it round-trips via `findIngredientsByFunction()` — this list isn't a Zod enum, so a drifted or misspelled entry fails silently (just never matches) rather than erroring.

---

## Documentation

If a change affects behavior described in `README.md`, `architecture-overview.md`, or `file-map.md`, update the relevant doc in the same PR — these are treated as living documents, not a one-time onboarding artifact. `site/index.html` (the public landing page) only needs updating for changes a non-technical visitor would care about; don't add implementation detail there.
