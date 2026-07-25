# Radiance AI

An agentic recommendation system for cosmetic and skincare products. A multi-agent LangGraph workflow drives the core reasoning loop: it interviews the user to build a safety profile, searches a vector catalog, runs ingredient safety checks, and generates personalised product recommendations — all over a stateless REST API backed by persistent session storage.

---

## System Architecture

```mermaid
flowchart TB
    FE["radiance-ai-frontend<br/>(Next.js — separate repo)"] -->|"HTTP POST /api/chat"| RT

    subgraph RT ["ai/ (runtime)"]
        CTRL["Controller → Service"] --> WF["LangGraph Workflow"]
        WF --> AGENTS["Supervisor · Questioner · ProductFinder<br/>WebResearcher · SafetyChecker · Recommender"]
        AGENTS --> REPOS["Repositories"]
        REPOS --> PR["productRepository<br/>(Qdrant + MongoDB)"]
        REPOS --> SR["safetyRulesRepository<br/>(PostgreSQL)"]
        REPOS --> CR["cosingRestrictionsRepository<br/>(PostgreSQL — EU CosIng)"]
        WF --> SESS["sessionStore<br/>(PostgreSQL)"]
    end

    subgraph DP ["data/ (offline pipeline)"]
        P1["01-migrate → PostgreSQL schema"]
        P2["02-seed-safety → contraindication rules"]
        P3["03/04-load-off/obf → Open Food/Beauty Facts → MongoDB"]
        P4["05-vectorize → embeddings → Qdrant"]
        P5["06/07-load-cosing → EU CosIng Annex II/III/IV/V → PostgreSQL"]
    end

    subgraph INFRA ["Infrastructure"]
        PG["PostgreSQL 16 + pgvector"]
        MDB["MongoDB 7"]
        QD["Qdrant 1.18"]
        LLM["LiteLLM proxy (port 4000)"]
        LMS["LM Studio (local models)"]
    end

    RT -.-> INFRA
    DP -.-> INFRA
```

All LLM and embedding calls are routed through a **LiteLLM proxy**, which decouples model selection from application code. Swapping providers (OpenAI, Anthropic, Gemini, local via LM Studio) requires only environment variable changes.

---

## Repository Structure

```
radiance-ai/
├── ai/                          # Runtime application
│   ├── src/
│   │   ├── agents/              # LangGraph agent nodes
│   │   │   ├── supervisor.ts    # Deterministic router (no LLM)
│   │   │   ├── questioner.ts    # Profile collection + query refinement
│   │   │   ├── productFinder.ts # Vector catalog search
│   │   │   ├── safetyChecker.ts # Two-layer safety check (see below)
│   │   │   ├── recommender.ts   # Ranked + LLM-enriched output
│   │   │   └── webResearcher.ts # Tavily web search fallback + LLM extraction
│   │   ├── graph/
│   │   │   ├── state.ts         # Immutable GraphState annotation
│   │   │   ├── workflow.ts      # LangGraph topology
│   │   │   └── runner.ts        # Single graph.invoke() entry point
│   │   ├── controllers/
│   │   │   └── chatController.ts
│   │   ├── services/
│   │   │   ├── chatService.ts   # Phase transitions + session management
│   │   │   └── sessionStore.ts  # Postgres-backed session persistence
│   │   ├── repositories/
│   │   │   ├── productRepository.ts      # Qdrant search + MongoDB hydration
│   │   │   ├── safetyRulesRepository.ts  # safety_rules table queries
│   │   │   └── cosingRestrictionsRepository.ts # EU CosIng annex queries
│   │   ├── llm/
│   │   │   ├── client.ts        # chatCompletion() — fetch wrapper + presets
│   │   │   ├── embeddings.ts    # generateEmbedding() — fetch wrapper
│   │   │   └── prompts.ts       # All system prompts
│   │   ├── infra/
│   │   │   ├── db.ts            # PostgreSQL pool
│   │   │   ├── mongo.ts         # MongoDB client
│   │   │   └── qdrant.ts        # Qdrant client
│   │   ├── config/
│   │   │   └── profileQuestions.ts
│   │   ├── common/
│   │   │   ├── errors.ts             # Typed error hierarchy
│   │   │   ├── allergyNormalizer.ts  # Free-text allergy/condition → known tags
│   │   │   └── inci.ts               # INCI ingredient parsing helpers
│   │   ├── tools/
│   │   │   ├── webSearch.ts     # Tavily search tool
│   │   │   └── pubmed/          # PubMed evidence search + summarization (used by questioner.ts)
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── index.ts              # Package entry point — re-exports run() from graph/runner
│   │   └── server.ts            # Express entry point
│   ├── .env                     # Local environment (not committed)
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── data/                        # Offline data pipeline
│   ├── pipeline/
│   │   ├── 01-migrate.ts        # Run all SQL migrations
│   │   ├── 02-seed-safety.ts    # Seed ingredient safety rules
│   │   ├── 03-load-off.ts       # Open Food Facts dump → MongoDB (currently skipped in run-all)
│   │   ├── 04-load-obf.ts       # Open Beauty Facts dump → MongoDB
│   │   ├── 05-vectorize.ts      # Generate embeddings → Qdrant
│   │   ├── 06-load-cosing-restrictions.ts # EU CosIng Annex III/IV/V → PostgreSQL
│   │   ├── 07-load-cosing-prohibited.ts   # EU CosIng Annex II → PostgreSQL
│   │   └── run-all.ts           # Run full pipeline in sequence
│   ├── src/
│   │   ├── infra/
│   │   │   ├── db.ts
│   │   │   ├── mongo.ts
│   │   │   ├── qdrant.ts          # generateEmbedding + QdrantClient
│   │   │   ├── dataLoader.ts      # SHA256-cached dump download + mongorestore
│   │   │   └── migrate.ts         # Discovers + runs migrations/*.sql in order
│   │   └── common/
│   │       └── countryNormalizer.ts
│   ├── migrations/
│   │   ├── 001_init.sql             # pgvector + uuid-ossp extensions
│   │   ├── 002_safety_rules.sql     # safety_rules table
│   │   ├── 003_user_profiles.sql    # user_sessions, conversation_history
│   │   ├── 004_session_state.sql    # adds phase/profile/questioning to user_sessions
│   │   ├── 005_cosing_restrictions.sql   # cosing_restrictions table (Annex III/IV/V)
│   │   └── 006_cosing_prohibited.sql     # cosing_prohibited_substances table (Annex II)
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
└── docker/
    ├── docker-compose.yml       # PostgreSQL, MongoDB, Qdrant, LiteLLM
    └── litellm-config.yaml      # Model routing configuration
```

---

## Agent Workflow

```mermaid
flowchart LR
    START([START]) --> SUP{Supervisor}

    SUP -->|profile incomplete<br/>or query not ready| Q[Questioner<br/>interview]
    Q --> SUP

    SUP -->|pending questions| DONE1([done])

    SUP -->|no catalog results| PF[ProductFinder<br/>catalog_search]
    PF --> SUP

    SUP -->|catalog empty| WR[WebResearcher<br/>web_search]
    WR --> SUP

    SUP -->|safety checks not run| SC[SafetyChecker<br/>safety_check]
    SC --> SUP

    SUP -->|no final recommendations| REC[Recommender<br/>recommend]
    REC --> END1([END])

    SUP -->|all steps complete| DONE2([done]) --> END2([END])
    SUP -->|max iterations reached| ERR([error]) --> END3([END])
```

The **Supervisor** is fully deterministic — it inspects graph state and routes without calling an LLM:

| Condition | Next step |
|-----------|-----------|
| Profile incomplete or query not ready | `questioner` |
| Pending questions exist | `done` (surface to user) |
| No catalog results | `product_finder` |
| Catalog empty after search | `web_researcher` |
| Safety checks not run | `safety_checker` |
| No final recommendations | `recommender` |

Hard cap: 10 iterations maximum to prevent runaway loops.

**Safety Checker (two layers)**
- **Layer 1 (deterministic):** `safety_rules` lookup + EU CosIng Annex II (prohibited → hard block) and Annex III/IV/V (restricted → caution signal). Critical/high-severity violations and Annex II matches are hard blocks — final, never passed to Layer 2.
- **Layer 2 (LLM):** reviews only the products Layer 1 flagged as ambiguous (medium/low violation, EU restriction, sparse data, unrecognized condition) in a single batched call. Cannot escalate a product to hard block — the output schema has no such option, and hard-blocked products are never sent to it.
- Output: `SafetyReport { approved, softWarnings, hardBlocks }` on graph state, plus the flat `safetyCheckedProducts` (`approved + softWarnings`) used by the Recommender.

---

## Prerequisites

- Node.js 20.6+
- Docker and Docker Compose
- LM Studio (for local model inference, optional — any OpenAI-compatible endpoint works)
- `mongodb-database-tools` on `PATH` (provides `mongorestore`, required by the OFF/OBF pipeline load steps — `brew install mongodb-database-tools` on macOS, `apt-get install mongodb-database-tools` on Ubuntu)

---

## Infrastructure Setup

Start all backing services:

```bash
docker compose -f docker/docker-compose.yml up -d
```

This starts:
- **PostgreSQL 16** with pgvector on port `5434`
- **MongoDB 7** on port `27017`
- **Qdrant 1.18** on ports `6333` / `6334`
- **LiteLLM proxy** on port `4000`

Verify all services are healthy:

```bash
docker compose -f docker/docker-compose.yml ps
```

---

## Data Pipeline

The pipeline is a one-time (or periodic) offline process that prepares data for the runtime application. Run it once before starting the API server.

### Install dependencies

```bash
cd data && npm install
```

### Configure environment

```bash
cp data/.env.example data/.env
# Edit data/.env with your values
```

### Run the full pipeline

```bash
cd data && npm run pipeline
```

Or run individual steps:

```bash
npm run pipeline:migrate    # Apply SQL migrations to PostgreSQL
npm run pipeline:safety     # Seed ingredient contraindication rules
npm run pipeline:load       # Download and load OFF/OBF dumps into MongoDB
npm run pipeline:vectorize  # Generate embeddings and upsert into Qdrant
npm run pipeline:cosing     # Load EU CosIng Annex II/III/IV/V into PostgreSQL
```

`run-all.ts` runs migrate → safety → cosing (restrictions, then prohibited) → OBF load → vectorize, in that order (the OFF load is currently commented out in `run-all.ts`). The vectorize step auto-detects embedding dimensions and recreates the Qdrant collection if the model has changed. Requires `mongorestore` (part of `mongodb-database-tools`) on `PATH` for the OFF/OBF load steps.

---

## Runtime API Server

### Install dependencies

```bash
cd ai && npm install
```

### Configure environment

```bash
cp ai/.env.example ai/.env
# Edit ai/.env with your values
```

### Start the development server

```bash
cd ai && npm run dev
```

The server starts on `http://localhost:3001`.

### Health check

```bash
curl http://localhost:3001/health
```

### Send a chat message

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session-001", "message": "I have dry skin and redness"}' | jq .
```

---

## Request Workflow

Every `POST /api/chat` call goes through the same pipeline:

```mermaid
sequenceDiagram
    participant Client
    participant Controller as chatController
    participant Service as chatService
    participant Store as sessionStore (Postgres)
    participant Supervisor
    participant Questioner
    participant ProductFinder
    participant WebResearcher
    participant SafetyChecker
    participant Recommender
    participant LLM as LiteLLM proxy
    participant Data as Qdrant / Mongo / Postgres

    Client->>Controller: POST /api/chat {sessionId, message}
    Controller->>Service: handle(sessionId, message)
    Service->>Store: getSession(sessionId)
    Store-->>Service: phase, profile, history

    alt phase = init
        Service->>Service: detect greeting → phase=collecting
    else phase = collecting
        Service->>Service: ask next static profile question
    else phase = processing | questioning
        Service->>Supervisor: graph.invoke(state)

        loop until queryReady && profileComplete
            Supervisor->>Questioner: interview
            Questioner->>LLM: chatCompletion('questioner')
            LLM-->>Questioner: queryReady, profileComplete, questions, profile
            Questioner-->>Supervisor: updated state
        end

        Supervisor->>ProductFinder: catalog_search
        ProductFinder->>LLM: generateEmbedding(query)
        ProductFinder->>Data: Qdrant search + Mongo hydration
        Data-->>ProductFinder: catalogResults

        opt catalogResults empty
            Supervisor->>WebResearcher: web_search
            WebResearcher->>LLM: chatCompletion('webResearcher') per result
            WebResearcher-->>Supervisor: webResults
        end

        Supervisor->>SafetyChecker: safety_check
        SafetyChecker->>Data: safety_rules + CosIng Annex II/III/IV/V lookup (Layer 1)
        SafetyChecker->>LLM: chatCompletion('safetyChecker') for flagged products only (Layer 2)
        SafetyChecker-->>Supervisor: SafetyReport (approved / softWarnings / hardBlocks)

        Supervisor->>Recommender: recommend
        Recommender->>LLM: chatCompletion('recommender')
        LLM-->>Recommender: personalised explanations
        Recommender-->>Supervisor: finalRecommendations
        Supervisor-->>Service: finalState
    end

    Service->>Store: persist phase, profile, history
    Service-->>Controller: { phase, questions?, recommendations? }
    Controller-->>Client: response
```

Multi-turn conversations are stateless on the server between requests — all state (`phase`, `profile`, `questioning`, conversation history) round-trips through PostgreSQL via `sessionStore.ts`, keyed by `sessionId`. A new server instance can pick up any in-flight session.

---

## Environment Variables

### `ai/.env`

```env
PORT=3001

# LiteLLM proxy
LITELLM_BASE_URL=http://localhost:4000/v1
LITELLM_API_KEY=sk-litellm-master

# LLM model name as configured in litellm-config.yaml
LLM_MODEL=gemma-4-local

# Embedding model name as configured in litellm-config.yaml
EMBEDDING_MODEL=nomic-embed-text
# EMBEDDING_MODEL_DIMENSIONS=768   # Optional — only set for models that support
                                   # Matryoshka truncation (e.g. text-embedding-3-small)

# Web search (Tavily)
TAVILY_API_KEY=

# PostgreSQL
DB_HOST=localhost
DB_PORT=5434
DB_NAME=cosmetic_rai
DB_USER=postgres
DB_PASSWORD=postgres

# MongoDB
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_USER=mongo
MONGO_PASSWORD=mongo
MONGO_DB_NAME=obf

# Qdrant
QDRANT_URL=http://localhost:6333
```

### `data/.env`

Same infrastructure variables as above. `PORT`, `LLM_MODEL`, and `TAVILY_API_KEY` are not required.

---

## LLM Provider Configuration

Model routing is defined in `docker/litellm-config.yaml`. The proxy exposes an OpenAI-compatible API regardless of the underlying provider.

Provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`) are set in the `litellm` service's `environment:` block in `docker/docker-compose.yml` — **not** in `ai/.env` or `data/.env`. Replace the placeholder `some_key` values there for any provider you intend to use.

To switch models, change `LLM_MODEL` in `ai/.env` to any model name defined in `litellm-config.yaml`:

| Model name | Provider |
|------------|----------|
| `gemma-4-local` | LM Studio (local) |
| `gpt-4o-mini` | OpenAI |
| `gpt-4o` | OpenAI |
| `text-embedding-3-small` | OpenAI (embeddings) |
| `claude-3-5-haiku` | Anthropic |
| `claude-sonnet-4-5` | Anthropic |
| `gemini-2.0-flash` | Google |
| `gemini-2.5-pro` | Google |
| `grok-3` | xAI |
| `grok-3-mini` | xAI |
| `groq-llama-3.3-70b` | Groq |
| `groq-llama-3.1-8b` | Groq |
| `nomic-embed-text` | LM Studio (embeddings) |
| `gemini-embedding-2` | Google (embeddings) |

`litellm-config.yaml` also has `langfuse` set as the success/failure callback for observability. This is optional — no `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set in `docker-compose.yml` by default, so tracing is effectively a no-op until you add them.

---

## Design Principles

**Separation of concerns**
The `data/` package and `ai/` package share no code. `data/` is an offline pipeline that writes to the stores; `ai/` is a runtime application that reads from them. Cross-package imports are forbidden and enforced at the TypeScript compiler level via `rootDir`.

**Self-contained runtime**
The `ai/` package contains its own `infra/`, `repositories/`, `services/`, and `controllers/` layers. It has no dependency on `data/` at runtime.

**Provider abstraction**
All LLM and embedding calls go through two thin fetch wrappers (`llm/client.ts`, `llm/embeddings.ts`) targeting the LiteLLM proxy. No AI SDK is imported in the runtime application. Swapping providers requires only environment variable changes.

**Deterministic supervisor**
The Supervisor agent contains no LLM calls. Routing logic is pure TypeScript — predictable, testable, and fast.

**Typed error hierarchy**
All agent and repository errors are typed (`LlmCallError`, `RepositoryError`, `SchemaParseError`). The service layer maps these to user-facing messages without leaking internal detail.

**Persistent sessions**
Session state and conversation history are written to PostgreSQL (`user_sessions`, `conversation_history`) on every turn. The API server is stateless — any restart preserves active sessions.

---

## Troubleshooting

**LiteLLM returns 400 on embedding requests**

The `EMBEDDING_MODEL_DIMENSIONS` variable is set but the model does not support the `dimensions` parameter. Remove the variable or set it only for models that support Matryoshka truncation (OpenAI `text-embedding-3-*` family).

**Qdrant returns 400 "Vector dimension error"**

The collection was built with a different embedding model or dimension than the runtime is using. Re-run the vectorize pipeline — `initCollection()` detects the mismatch, recreates the collection, and re-vectorizes.

```bash
cd data && npm run pipeline:vectorize
```

**Products returned with name "Unknown Product"**

Approximately 37% of Open Beauty Facts documents have no `product_name` or `product_name_en` field. This is a data quality characteristic of the upstream dataset, not an application bug. Products with populated names will display correctly.

**Session not found after server restart**

If the PostgreSQL migration `004_session_state.sql` has not been applied, the `phase`, `profile`, and `questioning` columns do not exist. Apply the migration:

```bash
psql postgresql://postgres:postgres@localhost:5434/cosmetic_rai \
  -f data/migrations/004_session_state.sql
```

**Graph loops indefinitely or hits max iterations**

The Supervisor hard-caps at 10 iterations. If the cap is hit, the LLM is likely failing to set `queryReady=true`. Check LiteLLM logs for upstream errors and verify the model is reachable:

```bash
curl http://localhost:4000/health/liveliness
```

**`ts-node` cannot resolve modules**

Ensure `dotenv` is installed as a dev dependency in the relevant package and that the `.env` file exists. The dev script uses `-r dotenv/config` to load it before module resolution.
