# Radiance AI

An agentic recommendation system for cosmetic and skincare products. A multi-agent LangGraph workflow drives the core reasoning loop: it interviews the user to build a safety profile, searches a vector catalog, runs ingredient safety checks, and generates personalised product recommendations — all over a stateless REST API backed by persistent session storage.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    radiance-ai-frontend                  │
│                  (Next.js — separate repo)               │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP  POST /api/chat
┌───────────────────────────▼─────────────────────────────┐
│                        ai/  (runtime)                    │
│                                                          │
│  Controller → Service → LangGraph Workflow               │
│                            │                             │
│              ┌─────────────┼──────────────┐             │
│           Questioner  ProductFinder  SafetyChecker       │
│           Recommender  WebResearcher  Supervisor         │
│                            │                             │
│  Repositories ─────────────┤                             │
│    productRepository   (Qdrant + MongoDB)                │
│    safetyRulesRepository   (PostgreSQL)                  │
│                                                          │
│  Session store ────────────┘                             │
│    sessionStore            (PostgreSQL)                  │
└──────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                     data/  (offline pipeline)            │
│                                                          │
│  01-migrate     → PostgreSQL schema                      │
│  02-seed-safety → ingredient contraindication rules      │
│  03-load-products → Open Beauty Facts dump → MongoDB     │
│  04-vectorize   → embeddings → Qdrant                    │
└──────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      Infrastructure                      │
│  PostgreSQL 16 + pgvector  · MongoDB 7  · Qdrant 1.18   │
│  LiteLLM proxy (port 4000) · LM Studio (local models)   │
└──────────────────────────────────────────────────────────┘
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
│   │   │   ├── safetyChecker.ts # Ingredient contraindication checks
│   │   │   ├── recommender.ts   # Ranked + LLM-enriched output
│   │   │   └── webResearcher.ts # Tavily web search fallback
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
│   │   │   └── safetyRulesRepository.ts  # PostgreSQL safety rules query
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
│   │   │   └── errors.ts        # Typed error hierarchy
│   │   ├── tools/
│   │   │   └── webSearch.ts     # Tavily search tool
│   │   ├── types/
│   │   │   └── index.ts
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
│   │   ├── 03-load-products.ts  # Load OBF dump into MongoDB
│   │   ├── 04-vectorize.ts      # Generate embeddings → Qdrant
│   │   └── run-all.ts           # Run full pipeline in sequence
│   ├── src/
│   │   └── infra/
│   │       ├── db.ts
│   │       ├── mongo.ts
│   │       └── qdrant.ts        # generateEmbedding + QdrantClient
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_safety_rules.sql
│   │   ├── 003_user_profiles.sql
│   │   └── 004_session_state.sql
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

```
START → SUPERVISOR → QUESTIONER    → SUPERVISOR
                   → PRODUCT_FINDER → SUPERVISOR
                   → WEB_RESEARCHER → SUPERVISOR   (fallback if catalog empty)
                   → SAFETY_CHECKER → SUPERVISOR
                   → RECOMMENDER   → END
                   → ERROR         → END
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

---

## Prerequisites

- Node.js 20.6+
- Docker and Docker Compose
- LM Studio (for local model inference, optional — any OpenAI-compatible endpoint works)

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
npm run pipeline:load       # Download and load Open Beauty Facts dump into MongoDB
npm run pipeline:vectorize  # Generate embeddings and upsert into Qdrant
```

The vectorize step auto-detects embedding dimensions and recreates the Qdrant collection if the model has changed.

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

To switch models, change `LLM_MODEL` in `ai/.env` to any model name defined in `litellm-config.yaml`:

| Model name | Provider |
|------------|----------|
| `gemma-4-local` | LM Studio (local) |
| `gpt-4o-mini` | OpenAI |
| `gpt-4o` | OpenAI |
| `claude-3-5-haiku` | Anthropic |
| `claude-sonnet-4-5` | Anthropic |
| `gemini-2.0-flash` | Google |
| `groq-llama-3.3-70b` | Groq |
| `nomic-embed-text` | LM Studio (embeddings) |
| `gemini-embedding-2` | Google (embeddings) |

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
