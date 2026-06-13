# Radiance AI

A cosmetic product recommendation system powered by a multi-agent LLM workflow. It interviews the user, researches products for their country, validates ingredients against safety rules, and returns ranked recommendations.

## Architecture

```mermaid
flowchart TD
    subgraph UI["ui/ — Next.js 14"]
        Browser["Browser Chat"]
        Hook["useChat hook"]
        Cards["RecommendationCard"]
        Route["POST /api/chat"]
        SessionStore["Session Store"]
        AIClient["aiClient.ts"]
    end

    subgraph AI["ai/ — radiance-ai-core"]
        Supervisor["Supervisor\n(deterministic router)"]
        Interview["Interview Agent"]
        Research["Web Research Agent\n(Tavily)"]
        Safety["Safety Check Agent"]
        Recommend["Recommender Agent\n(LLM explanations)"]
    end

    subgraph Infra["Infrastructure (Docker)"]
        PG["PostgreSQL\nsafety_rules"]
        Mongo["MongoDB\nOBF products"]
        Qdrant["Qdrant\nvector search"]
        LiteLLM["LiteLLM Proxy\n:4000"]
    end

    Browser --> Hook --> Route
    Route --> SessionStore
    Route --> AIClient
    AIClient -->|"in-process (default)"| Supervisor
    AIClient -->|"AI_BACKEND_URL set"| ExtService["Remote AI Service"]

    Supervisor --> Interview
    Supervisor --> Research
    Supervisor --> Safety
    Supervisor --> Recommend

    Safety --> PG
    Research --> Mongo
    Research --> Qdrant
    Interview --> LiteLLM
    Safety --> LiteLLM
    Recommend --> LiteLLM

    Recommend --> Route
    Route --> Cards --> Browser
```

All LLM calls route through a **LiteLLM proxy** (port 4000), which abstracts over OpenAI and Anthropic models. Product safety rules are stored in **PostgreSQL 16 + pgvector**.

### Request Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Next.js UI<br/>(port 3000)
    participant API as /api/chat<br/>(route.ts)
    participant Session as Session Store<br/>(in-memory Map)
    participant Client as aiClient.ts<br/>(plug-and-play)
    participant Core as radiance-ai-core<br/>(in-process)
    participant Graph as LangGraph Workflow

    User->>UI: types message
    UI->>API: POST /api/chat<br/>{ sessionId, message }

    API->>Session: getSession(sessionId)
    Session-->>API: session { phase, answers }

    alt phase = init / collecting
        API->>Session: store answer, advance question index
        API-->>UI: { phase: collecting, message: "next question" }
        UI-->>User: displays next profile question
    end

    alt phase = processing (all 4 answers collected)
        API->>Client: invokeGraph(userProfile, query)

        alt AI_BACKEND_URL is empty
            Client->>Core: require('radiance-ai-core').run(options)
        else AI_BACKEND_URL is set
            Client->>Client: fetch(AI_BACKEND_URL + '/invoke', body)
        end

        Core->>Graph: invoke(state)

        loop LangGraph State Machine (max 10 iterations)
            Graph->>Graph: SUPERVISOR — deterministic routing
            alt incomplete profile
                Graph->>Graph: INTERVIEW agent
            else no research results
                Graph->>Graph: RESEARCH agent<br/>(Tavily web search)
            else safety not checked
                Graph->>Graph: SAFETY_CHECK agent<br/>(PostgreSQL rules)
            else ready
                Graph->>Graph: RECOMMEND agent<br/>(LLM explanations)
            end
        end

        Graph-->>Core: final state
        Core-->>Client: { recommendations[], error? }
        Client-->>API: GraphResult

        API->>Session: setSession phase = done
        API-->>UI: { phase: done, recommendations[] }
        UI-->>User: renders RecommendationCards
    end
```

---

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- An OpenAI API key (required); Anthropic API key (optional, for Claude models)

---

## Setup

### 1. Start infrastructure

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...   # optional

docker-compose -f docker/docker-compose.yml up -d
```

This starts:
- **PostgreSQL 16 + pgvector** on port `5432` (db: `cosmetic_rai`, user/pass: `postgres`)
- **LiteLLM proxy** on port `4000` — automatically applies migrations from `data/migrations/`

### 2. Install dependencies

```bash
cd ai && npm install
cd ../data && npm install
```

### 3. Seed the databases

#### 3.1. Seed products from Open Beauty Facts

```bash
docker compose -f docker/docker-compose.yml --profile seed run --rm obf-seed
```

- Downloads and inserts the latest product dump from openbeautyfacts into mongodb.

#### 3.2. Sync products to Qdrant

```bash
export EMBEDDING_MODEL=...
export EMBEDDING_MODEL_DIMENSIONS=...   

npm run sync -- [# of products]    # Replace [# of products] with how many products to sync
```

#### 3.3. Seed safty rules

```bash
cd data && npm run seed
```

- Inserts ~30 ingredient safety rules (e.g. retinol + pregnancy = critical).

## Running

### Development (auto-restart on file changes)

```bash
cd ai && npm run dev
```

### Production build

```bash
cd ai && npm run build
cd data && npm run build
```

---

## Environment Variables

All variables have defaults suitable for local development.

| Variable | Default | Description |
|----------|---------|-------------|
| `LITELLM_BASE_URL` | `http://localhost:4000/v1` | LiteLLM proxy endpoint |
| `LITELLM_API_KEY` | `sk-litellm-master` | Proxy master key |
| `LLM_MODEL` | `gpt-4o-mini` | Model name as configured in `litellm-config.yaml` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model name as configured in `litellm-config.yaml` |
| `EMBEDDING_MODEL_DIMENSIONS` | `1536` | Model dimensions as configured in `litellm-config.yaml` |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `cosmetic_rai` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |

---

## Testing

```bash
# AI layer tests
cd ai && npm test

# Data layer tests
cd data && npm test

# Single test file
cd ai && npx jest tests/agents/supervisor.test.ts
```

Tests are fully mocked — no live database or LLM calls required.

---

## Available LLM Models

Configured in `docker/litellm-config.yaml`:

| Model name | Provider | API key env var |
|-----------|----------|----------------|
| `gpt-4o-mini` | OpenAI (default) | `OPENAI_API_KEY` |
| `gpt-4o` | OpenAI | `OPENAI_API_KEY` |
| `text-embedding-3-small` | OpenAI | `OPENAI_API_KEY` |
| `claude-3-5-haiku` | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-sonnet-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `gemini-2.0-flash` | Google | `GEMINI_API_KEY` |
| `gemini-2.5-pro` | Google | `GEMINI_API_KEY` |
| `gemini-embedding-2` | Google | `GEMINI_API_KEY` |
| `grok-3` | xAI | `XAI_API_KEY` |
| `grok-3-mini` | xAI | `XAI_API_KEY` |
| `groq-llama-3.3-70b` | Groq | `GROQ_API_KEY` |
| `groq-llama-3.1-8b` | Groq | `GROQ_API_KEY` |

Switch models by setting `LLM_MODEL` to any name from the table above. Only the API key for the chosen provider is required.
