# Radiance AI

An agentic recommendation system for cosmetic and skincare products. A multi-agent LangGraph workflow drives the core reasoning loop: it interviews the user to build a safety profile, searches a vector catalog, runs ingredient safety checks, and generates personalised product recommendations — all over a stateless REST API backed by persistent session storage.

---

## Architecture

An agentic LangGraph workflow (Supervisor → Questioner → ProductFinder/WebResearcher → SafetyChecker → Recommender) backed by Qdrant (vector search), MongoDB (product catalog), and PostgreSQL (sessions, safety rules, EU CosIng data), all LLM/embedding calls routed through a LiteLLM proxy.

Full system diagrams, the agent workflow (including the two-layer Safety Checker), and the request lifecycle live in **[docs/architecture-overview.md](docs/architecture-overview.md)**.

For an annotated guide to every source file — what it does, read-order, and which files need extra care when modified — see **[docs/file-map.md](docs/file-map.md)**.

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

Every `POST /api/chat` call goes through the same pipeline — session lookup → LangGraph invocation (or a static profile question) → session persistence. See the **Request Lifecycle** sequence diagram and request-correlation (`X-Request-Id` / `[req=...]` log prefixing) details in [docs/architecture-overview.md](docs/architecture-overview.md#request-lifecycle-post-apichat).

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

See **[docs/architecture-overview.md](docs/architecture-overview.md#design-principles-as-implemented)** for package isolation, provider abstraction, the deterministic supervisor, typed error hierarchy, and schema-validated LLM output — as actually implemented in this codebase.

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
