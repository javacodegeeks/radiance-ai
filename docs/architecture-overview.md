# Architecture Overview — Radiance AI

An agentic recommendation system for cosmetic/skincare products. A multi-agent LangGraph workflow interviews the user, retrieves candidate products from a hybrid catalog, runs a two-layer ingredient safety check, and generates personalised, explained recommendations — plus an AM/PM routine, deterministic ingredient-interaction warnings, and algorithmically-resolved complementary products for any flagged side-effect risk — served over a stateless REST API (with an optional SSE progress stream) with all conversational state persisted in PostgreSQL.

This repo contains two independent packages (`ai/` runtime, `data/` offline pipeline) that share **no code** — enforced at the TypeScript compiler level via `rootDir`. The frontend (`radiance-ai-frontend`, Next.js) lives in a separate repository and talks to `ai/` only via `POST /api/chat` (JSON or SSE) and `POST /api/feedback`.

---

## System Diagram

```mermaid
flowchart TB
    FE["radiance-ai-frontend<br/>(Next.js — separate repo)"] -->|"HTTP POST /api/chat (JSON or SSE)"| CTRL
    FE -->|"HTTP POST /api/feedback"| FCTRL

    subgraph RT ["ai/ (runtime — stateless Express server)"]
        CTRL["chatController<br/>(HTTP layer)"] --> SVC["chatService<br/>(phase transitions)"]
        FCTRL["feedbackController"] --> FSVC["feedbackService"]
        SVC --> WF["LangGraph workflow<br/>(graph/runner.ts)"]
        WF --> AGENTS["Supervisor · Questioner · ProductFinder<br/>WebResearcher · SafetyChecker · Recommender"]
        WF --> AUDIT["safetyAuditService<br/>(best-effort, post-run)"]
        AGENTS --> REPOS["Repositories"]
        SVC --> SESS["sessionStore<br/>(PostgreSQL)"]
    end

    REPOS --> PR["productRepository<br/>(Qdrant search + MongoDB hydration)"]
    REPOS --> SR["safetyRulesRepository<br/>(PostgreSQL — safety_rules)"]
    REPOS --> CR["cosingRestrictionsRepository<br/>(PostgreSQL — EU CosIng Annex II-V)"]
    REPOS --> CFR["cosingFunctionsRepository<br/>(PostgreSQL — EU CosIng function glossary)"]
    FSVC --> FR["feedbackRepository<br/>(MongoDB — recommendation_feedback)"]
    AUDIT --> AR["safetyAuditRepository<br/>(MongoDB — safety_audit_log)"]

    subgraph DP ["data/ (offline pipeline — run once/periodically)"]
        P1["01-migrate"] --> P2["02-seed-safety"]
        P2 --> P5["06/07-load-cosing + 09-load-cosing-functions"]
        P5 --> P3["04-load-obf → MongoDB"]
        P3 --> P4["05-vectorize → Qdrant"]
        P4 --> P6["08-classify-categories<br/>(idempotent, LLM batch)"]
    end

    subgraph INFRA ["Infrastructure (docker/docker-compose.yml)"]
        PG["PostgreSQL 16 + pgvector<br/>:5434"]
        MDB["MongoDB 7<br/>:27017"]
        QD["Qdrant 1.18<br/>:6333/6334"]
        LLM["LiteLLM proxy<br/>:4000"]
        LMS["LM Studio<br/>(local models, optional)"]
    end

    AGENTS -.->|chatCompletion / generateEmbedding| LLM
    LLM -.-> LMS
    PR -.-> QD
    PR -.-> MDB
    SR -.-> PG
    CR -.-> PG
    CFR -.-> PG
    SESS -.-> PG
    FR -.-> MDB
    AR -.-> MDB
    DP -.-> PG
    DP -.-> MDB
    DP -.-> QD
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime API | Express 4 + TypeScript | Stateless HTTP server (`ai/`) |
| Agent orchestration | `@langchain/langgraph` | Deterministic state-machine graph of agent nodes |
| Web search tool | `@langchain/tavily` | Fallback product discovery when catalog search is empty — guarded by a timeout + circuit breaker (`common/resilience.ts`) |
| Vector search | Qdrant 1.18 | Cosine-similarity catalog search over product embeddings |
| Product catalog | MongoDB 7 | Raw Open Beauty/Food Facts (OBF/OFF) product documents |
| Relational store | PostgreSQL 16 + pgvector | Session state, conversation history, safety rules, EU CosIng data |
| LLM/embedding gateway | LiteLLM proxy | OpenAI-compatible facade over any provider (OpenAI, Anthropic, Gemini, xAI, Groq, local LM Studio) |
| Schema validation | Zod | Validates every LLM JSON response before use |
| Clinical evidence | PubMed E-utilities (`tools/pubmed/`) | Optional evidence lookup used by the Questioner |
| Testing | Jest + ts-jest | Unit/integration tests for both `ai/` and `data/` |
| Frontend (separate repo) | Next.js | Chat UI — consumes `POST /api/chat` only |

---

## Agent Workflow (LangGraph)

```mermaid
flowchart LR
    START([START]) --> SUP{Supervisor<br/>deterministic router}

    SUP -->|profile incomplete<br/>or query not ready| Q[Questioner]
    Q --> SUP
    SUP -->|pending questions| DONE1([done — pause for user])

    SUP -->|no catalog results| PF[ProductFinder<br/>catalog_search]
    PF --> SUP
    SUP -->|catalog empty| WR[WebResearcher<br/>web_search]
    WR --> SUP

    SUP -->|safety checks not run| SC[SafetyChecker<br/>safety_check]
    SC --> SUP

    SUP -->|no final recommendations| REC[Recommender<br/>recommend]
    REC --> END1([END])

    SUP -->|all steps complete| DONE2([done]) --> END2([END])
    SUP -->|10 iterations reached| ERR([error]) --> END3([END])
```

The **Supervisor** (`ai/src/agents/supervisor.ts`) makes no LLM calls — it inspects `GraphStateType` and returns the next `currentStep` with pure, testable TypeScript. Hard cap: 10 iterations, to guarantee termination.

| Node | LLM calls? | Responsibility |
|------|-----------|-----------------|
| `supervisor` | No | Routes to the next node based on graph state |
| `interview` (Questioner) | Yes | Refines the user's issue, collects safety-critical profile fields (country, allergies), optionally queries PubMed for evidence |
| `catalog_search` (ProductFinder) | Yes (embedding only) | Embeds the query, searches Qdrant, hydrates hits from MongoDB |
| `web_search` (WebResearcher) | Yes | Tavily search + LLM extraction of structured product data from raw page content — only runs if the catalog is empty. Timeout (8s) + circuit breaker around the Tavily call (`common/resilience.ts`) |
| `safety_check` (SafetyChecker) | Yes (Layer 2 only) | Two-layer ingredient safety review (see below) |
| `recommend` (Recommender) | Yes (up to 2 calls) | Ranks safety-checked products, generates personalised explanations + confidence score + AM/PM routine + side-effect risks; a second batched call explains any algorithmically-resolved complementary product and rebuilds the routine around it (see below) |

### Safety Checker — two layers

1. **Layer 1 (deterministic)** — `safetyRulesRepository` + `cosingRestrictionsRepository` lookups against the product's INCI/allergen tags and the user's allergies/conditions.
   - EU CosIng **Annex II** match (prohibited substance) or a **critical/high-severity** `safety_rules` violation → **hard block**, final, never seen by Layer 2.
   - EU CosIng **Annex III/IV/V** restriction, a lower-severity violation, sparse ingredient data, or an unrecognized condition → **flagged** for Layer 2.
   - No signal at all → **approved** directly, no LLM call spent.
2. **Layer 2 (LLM, batched)** — reviews only flagged products in a single call, with the user's actual concern/profile as context. Structurally **cannot** escalate to a hard block (the output schema has only `approved`/`soft_warning`). On LLM failure or a name-match miss, defaults to `soft_warning` (favors caution).

Output: `SafetyReport { approved, softWarnings, hardBlocks }`, plus a flattened `safetyCheckedProducts = approved + softWarnings` for the Recommender.

### Recommender — ranking vs. LLM confidence (two independent signals)

- **Ranking** (`rank()` in `recommender.ts`) happens *before* the LLM call: `SAFETY_WEIGHT[safetyStatus] * 0.6 + relevanceScore * 0.4`, where `relevanceScore` is a hardcoded safety-tier proxy set in `safetyChecker.ts` (0 / 0.5 / 0.7 / 0.9 / 1.0) — used only to order the top 5, never shown to the user.
- **Category-aware selection** (`selectCategoryAware()`) picks the best-ranked product per `REQUIRED_CATEGORIES` (`cleanser`, `moisturizer`) first, if one exists among the ranked candidates, then fills the remaining slots by score — avoids a 5-product recommendation set with no cleanser/moisturizer. `category` is precomputed offline (`data/pipeline/08-classify-categories.ts`); products with no category just fall back to plain score order.
- **`confidence`** is a genuine LLM-self-reported 0–100 signal, generated during the enrichment call, calibrated against ingredient completeness/goal match/safety status, and rendered in the UI as "% match." It is deliberately independent of the ranking formula — display order and confidence value can therefore diverge (documented, not currently reconciled).

### Recommender — routine generation, interaction warnings, and complementary products

The same `enrichWithLlm()` call that generates per-product explanations also returns an AM/PM `routine` and any `sideEffectRisks` the model flagged; a few extra steps ground/extend that output before it reaches the response:

1. **`interactionWarnings` are deterministic, not LLM-generated.** `detectInteractionConflicts()` matches a small curated set of known ingredient-pair conflicts (`INTERACTION_RULES` — e.g. retinoid + AHA/BHA, vitamin C + retinol, benzoyl peroxide + retinoid) against the recommended products' *actual* INCI lists. A rule only fires when both sides of the pair are genuinely present — the warning can never be hallucinated or missed the way a free-text LLM-generated warning could.
2. **Side-effect risks are resolved to a real complementary product, never invented.** For each LLM-flagged `SideEffectRisk` (`productName`, `risk`, `counteractingFunction`), `resolveComplementaryProducts()`:
   - Validates `counteractingFunction` against `COSING_FUNCTION_NAMES` (the closed EU CosIng function glossary, `repositories/cosingFunctionsRepository.ts`) — an unrecognized value skips just that one risk rather than failing the whole recommendation.
   - Looks up real ingredients carrying that function, then searches the already safety-checked candidate pool for a product containing one of them.
   - Falls back to `findSecondPassCandidate()` — a **fresh** embedding + Qdrant + Mongo search targeted at the counteracting ingredients (the original pool was built for the user's primary concern, which is usually unrelated to a side-effect like dizziness/nausea), safety-checked (Layer 1 only, via `checkProductSafety`) before acceptance.
   - Any failure at any step (unrecognized function, empty lookup, no candidate, LLM failure) just leaves the risk noted with no complementary product — never blocks the primary recommendation flow.
3. **`buildComplementaryRoutine()`** — one batched LLM call (mirroring Layer 2's batching pattern in `safetyChecker.ts`) explains each resolved complementary product's fit and rebuilds the *full* routine around it; `interactionWarnings` is then recomputed (deterministically) over the full product set including the complementary additions.

The flagged product itself is never dropped or reordered because of a side-effect risk — `sideEffectRisk` is purely informational, surfaced alongside the product regardless of whether a complementary product could be resolved for it.

---

## Request Lifecycle (`POST /api/chat`)

```mermaid
sequenceDiagram
    participant Client
    participant Controller as chatController
    participant Service as chatService
    participant Store as sessionStore (Postgres)
    participant Graph as LangGraph workflow
    participant LLM as LiteLLM proxy
    participant Data as Qdrant / Mongo / Postgres

    Client->>Controller: POST /api/chat {sessionId, message}
    Controller->>Controller: generate requestId → X-Request-Id header
    Controller->>Service: processMessage(sessionId, message)
    Service->>Store: getSession(sessionId)
    Store-->>Service: phase, profile, questioning, history

    alt phase = init
        Service->>Service: greeting? → phase=collecting
    else phase = collecting
        Service->>Service: ask next static profile question (config/profileQuestions.ts)
    else phase = processing | questioning
        Service->>Graph: graph.stream(state, onProgress?)
        Graph->>LLM: agent LLM calls (questioner/webResearcher/safetyChecker/recommender)
        Graph->>Data: catalog search, safety lookups, session-independent reads
        Graph-->>Service: finalState (recommendations or pendingQuestions)
    end

    Service->>Store: persist phase, profile, history
    Service-->>Controller: { phase, messages, recommendations? }
    Controller-->>Client: JSON response
```

Sessions are fully stateless between requests: `phase`, `profile`, `questioning`, and conversation history round-trip through PostgreSQL (`user_sessions`, `conversation_history`) via `sessionStore.ts`. Any server instance can resume any in-flight session.

**Request correlation**: `chatController` mints a short `requestId` per HTTP call, propagated through every layer via `AsyncLocalStorage` (`common/requestContext.ts`). `common/logger.ts` patches `console.*` once at startup to prefix every log line with `[req=<id>]`, and the same ID is persisted on the matching `conversation_history` row — so one turn's logs across all layers, or the DB row for a given log line, are always cross-referenceable.

**SSE progress streaming**: a client that sends `Accept: text/event-stream` gets the same request handled over Server-Sent Events instead of one-shot JSON. `graph/runner.ts`'s `run()` uses `graph.stream(..., { streamMode: 'values' })` instead of `graph.invoke()`, and calls `onProgress(label)` (a human-readable `STEP_LABELS[currentStep]`, e.g. "Checking ingredient safety...") each time the graph's `currentStep` changes — `chatController` relays each label as an `event: progress` SSE message, then closes with the identical final response as `event: done`. Clients that don't send that `Accept` header are unaffected — same `processMessage()` call, `onProgress` is simply `undefined`.

**Post-run safety audit**: after the graph finishes (success or not reaching this point on error), `run()` best-effort persists the full `safetyReport` (hardBlocks/softWarnings/approved) and `excludedRecommendations` via `safetyAuditService.auditSafetyReport()` → MongoDB `safety_audit_log`. A failure here is logged and swallowed — it never affects the chat response, which already has everything it needs from the graph's final state regardless of whether the audit write succeeds.

---

## Data Pipeline (`data/`, offline)

One-time/periodic process that prepares the stores `ai/` reads from at runtime. No shared code with `ai/`.

```
01-migrate                    → apply data/migrations/*.sql to PostgreSQL, in order
02-seed-safety                → seed safety_rules contraindication table
06-load-cosing-restrictions   → EU CosIng Annex III/IV/V → PostgreSQL
07-load-cosing-prohibited     → EU CosIng Annex II → PostgreSQL
09-load-cosing-functions      → EU CosIng ingredient-function glossary (~83 tags) + ingredient mappings → PostgreSQL
04-load-obf                   → Open Beauty Facts mongodump → MongoDB (03-load-off exists but is skipped in run-all.ts)
05-vectorize                  → embed product text → upsert into Qdrant (auto-recreates collection on dimension mismatch)
08-classify-categories        → batch-LLM classify each product's routine-sequencing category (cleanser/treatment/moisturizer/spf/exfoliant); idempotent, only targets products missing `category`
```

`data/pipeline/run-all.ts` is the canonical run order (script filenames are numbered by when they were introduced, not by run order — `run-all.ts`'s own step comments are the source of truth); individual steps are also runnable via `npm run pipeline:<step>`.

`09-load-cosing-functions`'s glossary (`COSING_FUNCTION_NAMES` in `ai/src/repositories/cosingFunctionsRepository.ts`) is a different, finer-grained axis than `08-classify-categories`'s `Product.category`: the glossary describes what an *ingredient* does (e.g. `MOISTURISING`, `EXFOLIATING`), used only to find a real product that counteracts a specific side-effect risk (see Recommender above); `category` describes what routine step a *product* belongs to. Neither computes or replaces the other.

---

## Feedback (`POST /api/feedback`)

Independent of the chat pipeline — a thin `feedbackController` → `feedbackService` → `feedbackRepository` path with no LangGraph involvement. Records a `'up' | 'down'` rating keyed on `(sessionId, productName, brand)` into MongoDB `recommendation_feedback`, upserting the current rating while appending every change to a `history` array — so a later reversal (up → down) doesn't silently overwrite the fact that the user first rated it up. Returns `204` on success; `503` if the repository call fails (`RepositoryError`), `500` otherwise.

---

## Design Principles (as implemented)

- **Package isolation** — `ai/` and `data/` share no code; enforced by separate `tsconfig.json` `rootDir` settings, not just convention.
- **Provider abstraction** — every LLM/embedding call goes through `llm/client.ts` / `llm/embeddings.ts` (thin `fetch` wrappers to the LiteLLM proxy). No AI SDK is imported in `ai/`. Swapping providers is an env-var change (`LLM_MODEL` in `ai/.env`, routing in `docker/litellm-config.yaml`).
- **Deterministic supervisor** — all routing logic in `agents/supervisor.ts` is plain TypeScript, no LLM calls, fully unit-testable.
- **Typed error hierarchy** (`common/errors.ts`) — `LlmCallError`, `RepositoryError`, `SchemaParseError` — mapped to generic user-facing messages in `chatService.ts` without leaking internals.
- **Schema-validated LLM output** — every LLM JSON response is parsed through a Zod schema before use; agents fall back to unenriched/cautious results on parse failure rather than propagating a malformed response.
- **Injection-aware prompts** — `QUESTIONER_SYSTEM`, `RECOMMENDER_SYSTEM`, `SAFETY_CHECKER_SYSTEM`, and `WEB_RESEARCHER_PRODUCT_SYSTEM` (`llm/prompts.ts`) each instruct the model to treat embedded user/catalog/web content as data, not instructions — relevant because product data is sourced from crowd-sourced (OBF/OFF) and scraped (Tavily) content.
- **Deterministic grounding of LLM side-outputs** — two LLM outputs that used to be pure free text are now checked against real data before use: `interactionWarnings` is recomputed by `detectInteractionConflicts()` against a curated rule set matched to actual product INCI lists (not the LLM's own words), and a flagged `SideEffectRisk.counteractingFunction` must match `COSING_FUNCTION_NAMES` (the DB-backed CosIng glossary) before a complementary product is searched for. Both fail closed (skip/omit) rather than propagate an unrecognized or hallucinated value.
- **Fail fast on a degraded external dependency** — `common/resilience.ts`'s `CircuitBreaker` + `withTimeout` guard the Tavily call in `webResearcher.ts`: after 3 consecutive failures/timeouts the circuit opens for 60s, so a down/degraded search provider doesn't stall every chat request behind an 8s timeout it's guaranteed to hit.

---

## Known Cross-Cutting Notes (not bugs — deliberate or documented trade-offs)

- **`relevanceScore` vs. `confidence`** — two distinct, intentionally-independent scores; see "Recommender" above.
- **Exact-string matching** — `recommender.ts`'s `mergeExplanations()` and `safetyChecker.ts`'s Layer 2 both match LLM output back to products by exact name string. SafetyChecker fails safe (defaults to caution on mismatch); Recommender fails silent (returns the product unenriched, no error surfaced).
- **`webResearcher.ts`'s `isProductResult()`** keyword-heuristic score and Qdrant's cosine-similarity `hit.score` (`productRepository.ts`) are both computed but currently discarded rather than surfaced — real signals not yet wired to any user-facing output.
- **Small local model target** — `LLM_MODEL=gemma-4-local` via LM Studio is the default dev model; prompt calibration/format-robustness (explicit numeric formats, calibration anchors) matters more here than it would against a large hosted model.
- **Layer 2's LLM reasoning isn't independently auditable yet** — `safetyChecker.ts`'s `applyLayer2Verdicts()` concatenates the Layer 2 LLM's own `reasoning` into the same `notes` string as the deterministic Layer 1 signal before either reaches `GraphStateType`/`safety_audit_log` — see the `TODO(audit)` at that call site. Answering "did the LLM say this, or was it the rule engine" currently requires reading the concatenated string, not a dedicated field.
