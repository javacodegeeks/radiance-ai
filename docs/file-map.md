# File Map — Radiance AI

Annotated guide to the codebase. Two independent packages: `ai/` (runtime API) and `data/` (offline pipeline) — see [architecture-overview.md](./architecture-overview.md) for how they relate. The frontend lives in a separate repository (`radiance-ai-frontend`) and is out of scope here.

---

## Key Files — `ai/` (runtime)

Read in roughly this order to understand the system.

| Priority | Path | What It Does | When to Read |
|----------|------|---------------|---------------|
| 1 | `ai/src/graph/state.ts` | `GraphStateType` — the single shared state object every agent reads/writes. Defines reducers (merge vs. replace) per field. | First day |
| 2 | `ai/src/graph/workflow.ts` | LangGraph topology — which node follows which, entry point, conditional edges. | First day |
| 3 | `ai/src/agents/supervisor.ts` | Deterministic router — no LLM calls. The actual control flow of the whole system lives here as plain `if` statements. | First day |
| 4 | `ai/src/services/chatService.ts` | Session phase state machine (`init → collecting → questioning/processing → done/error`) that wraps the graph. Owns the multi-turn conversation logic outside the graph itself. | First day |
| 5 | `ai/src/types/index.ts` | Core domain types (`Product`, `RecommendedProduct`, `UserProfile`, `QueryContext`, `SafetyReport`). Referenced by nearly every other file. | First day |
| 6 | `ai/src/agents/questioner.ts` | LLM-driven interview: refines the issue, collects profile fields, decides when to stop asking questions. Largest agent file (351 lines). | First week |
| 7 | `ai/src/agents/safetyChecker.ts` | Two-layer safety check — deterministic rule lookup (Layer 1) + batched LLM contextual review (Layer 2). Largest single piece of business logic (343 lines). | First week |
| 8 | `ai/src/agents/recommender.ts` | Ranks safety-checked products, calls LLM for personalised explanations + confidence score, merges by exact product name. | First week |
| 9 | `ai/src/agents/webResearcher.ts` | Tavily search + LLM extraction from raw scraped page content. Only path in the codebase that feeds untrusted external HTML/text directly to an LLM. | First week |
| 10 | `ai/src/agents/productFinder.ts` | Embeds the query, searches Qdrant, hydrates hits via `productRepository`. Primary (non-LLM-heavy) product source. | First week |
| 11 | `ai/src/llm/prompts.ts` | Every system prompt in the codebase, in one file. Naming convention: `<AGENT>_<PURPOSE>_SYSTEM`. | First week |
| 12 | `ai/src/llm/client.ts` | `chatCompletion()` — the only way agents call the LLM. Generation presets (temperature/max_tokens) per agent live here, not in the agents themselves. | First week |
| 13 | `ai/src/repositories/productRepository.ts` | Qdrant vector search + MongoDB document hydration. Where OBF/OFF's inconsistent field names (image URLs, product names) get normalized into `Product`. | First week |
| 14 | `ai/src/repositories/safetyRulesRepository.ts` / `cosingRestrictionsRepository.ts` | PostgreSQL lookups backing Safety Checker Layer 1 (contraindications, EU CosIng Annex II–V). | First week |
| 15 | `ai/src/services/sessionStore.ts` | PostgreSQL-backed session persistence (`user_sessions`, `conversation_history`). The only place session state is read/written. | First week |
| 16 | `ai/src/controllers/chatController.ts` | The one HTTP route (`POST /api/chat`). Thin — generates `requestId`, delegates to `chatService`, no business logic. | First week |
| 17 | `ai/src/common/requestContext.ts` + `common/logger.ts` | `AsyncLocalStorage`-based request-ID propagation and log prefixing. Explains why every log line has `[req=...]` with no explicit threading in call sites. | As needed |
| 18 | `ai/src/common/allergyNormalizer.ts` | Free-text allergy/condition strings → known safety-category tags. Directly affects whether Safety Checker Layer 1 can match a user's stated allergy. | As needed |
| 19 | `ai/src/common/errors.ts` | Typed error hierarchy (`LlmCallError`, `RepositoryError`, `SchemaParseError`) used to map failures to safe, generic user-facing messages. | As needed |
| 20 | `ai/src/tools/pubmed/` | Optional clinical-evidence lookup used by the Questioner (`searchClinicalEvidence.ts` → `summarizeEvidence.ts`). Self-contained subsystem, only touches PubMed's public E-utilities API. | As needed |

### Dangerous files — coordinate before modifying

| Path | Risk | Why |
|------|------|-----|
| `ai/src/graph/state.ts` | Changing a reducer (merge vs. replace) silently changes how every agent's partial return is combined into state — easy to reintroduce a stale-overwrite bug. | Test the full graph run, not just the changed agent, after any edit. |
| `ai/src/agents/supervisor.ts` | Sole source of control flow. A routing change can create an infinite loop (mitigated only by the 10-iteration hard cap) or skip a required step (e.g. skip safety check). | Re-run the full agent test suite; trace at least one multi-turn conversation manually. |
| `ai/src/llm/prompts.ts` | Every prompt here targets a small local model (`gemma-4-local`) in dev — wording changes that work fine against a large hosted model can silently break JSON-mode compliance on the local model. Also the injection-defense clauses here are load-bearing (see architecture doc). | Test against the actual configured `LLM_MODEL`, not assumptions from a larger model's behavior. |
| `ai/src/agents/safetyChecker.ts` | User-facing safety logic. Layer 1 severity thresholds and the Layer 2 "cannot escalate to hard block" schema constraint are intentional safety invariants, not incidental design. | Any change here should be treated as a safety-review change, not a routine refactor. |
| `data/migrations/*.sql` | Applied in filename order, additive only (existing migrations use `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`). Editing an already-applied migration file does nothing for existing databases — it silently diverges from what's actually in Postgres. | Always add a new numbered migration; never edit a committed one. |
| `ai/src/llm/client.ts` (`PRESETS`) | `max_tokens` per preset has already caused truncated-JSON production incidents (see git history: `6f594a6`, `242de6d`) when set too low for a given prompt/schema size. | If you see `finish_reason === 'length'` warnings in logs, raise the preset's `max_tokens` rather than shrinking the prompt/schema. |

---

## Key Files — `data/` (offline pipeline)

| Priority | Path | What It Does | When to Read |
|----------|------|---------------|---------------|
| 1 | `data/pipeline/run-all.ts` | Canonical run order: migrate → seed-safety → cosing (restrictions, then prohibited) → OBF load → vectorize. | First day |
| 2 | `data/migrations/*.sql` | Schema history, applied in numeric filename order by `data/src/infra/migrate.ts`. | First day |
| 3 | `data/pipeline/04-load-obf.ts` | Downloads (SHA256-cached) and `mongorestore`s the Open Beauty Facts dump into MongoDB, unfiltered. | First week |
| 4 | `data/pipeline/05-vectorize.ts` | Generates embeddings for product text, upserts into Qdrant. Auto-detects dimension mismatches and recreates the collection. | First week |
| 5 | `data/pipeline/02-seed-safety.ts` | Seeds the `safety_rules` contraindication table that `ai/`'s Safety Checker Layer 1 queries at runtime. | First week |
| 6 | `data/pipeline/06-load-cosing-restrictions.ts` / `07-load-cosing-prohibited.ts` | Loads EU CosIng Annex III/IV/V (restricted) and Annex II (prohibited) CSVs into PostgreSQL. | First week |
| 7 | `data/src/infra/dataLoader.ts` | Shared cached-download + `mongorestore` helper used by the OFF/OBF load steps. | As needed |

### Dangerous files — coordinate before modifying

| Path | Risk | Why |
|------|------|-----|
| `data/pipeline/04-load-obf.ts` | Raw `mongorestore` of the full upstream dump — no field filtering at load time. Any assumption about "which fields exist" belongs in `ai/src/repositories/productRepository.ts`'s `toProduct()`, not here. | Don't add field-shaping logic here; keep the raw-load/normalize boundary at the repository layer. |
| `data/pipeline/05-vectorize.ts` | Changing the embedding model or its dimensions requires the Qdrant collection to be recreated — this script already handles that, but `ai/.env`'s `EMBEDDING_MODEL` must be kept in sync or search silently degrades. | Update both `data/.env` and `ai/.env` together when changing embedding models. |

---

## Infrastructure & Config

| Path | What It Does |
|------|---------------|
| `docker/docker-compose.yml` | PostgreSQL (pgvector), MongoDB, Qdrant, LiteLLM proxy — all backing services for local dev. |
| `docker/litellm-config.yaml` | Model routing: maps logical model names (`gemma-4-local`, `gpt-4o-mini`, etc.) to actual providers. Change here + `LLM_MODEL`/`EMBEDDING_MODEL` in `.env` to swap providers. |
| `ai/.env.example` / `data/.env.example` | All environment variables, documented. Copy to `.env` and fill in per the README's "Environment Variables" section. |
| `ai/jest.config.js` / `data/jest.config.js` | Jest config per package — the two packages are tested independently. |
| `.github/workflows/*.yml` | CI: PR test runs and approval checks. |

---

## Not Covered Here

- Local setup steps, environment variable reference, and troubleshooting — already thoroughly documented in the repo root [`README.md`](../README.md); not duplicated here to avoid drift.
- Frontend file map — `radiance-ai-frontend` is a separate git repository.
