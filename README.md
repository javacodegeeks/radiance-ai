# Radiance AI

A cosmetic product recommendation system powered by a multi-agent LLM workflow. It interviews the user, researches products for their country, validates ingredients against safety rules, and returns ranked recommendations.

## Architecture

```
User Query
    │
    ▼
Supervisor (deterministic routing)
    ├── Questioner   — collects skin profile, allergies, country
    ├── Web Researcher — fetches products via Tavily Search
    ├── Safety Checker — validates ingredients against contraindications (PostgreSQL)
    └── Recommender  — ranks and returns top 5 products
```

All LLM calls route through a **LiteLLM proxy** (port 4000), which abstracts over OpenAI and Anthropic models. Product safety rules are stored in **PostgreSQL 16 + pgvector**.

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

### 3. Seed the database

```bash
cd data && npm run seed
```

This inserts ~30 ingredient safety rules (e.g. retinol + pregnancy = critical).

---

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
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `cosmetic_rai` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |

---

## Using the AI Layer

The `ai` package exposes a single `run()` function:

```typescript
import { run } from './src/index';

const result = await run({
  sessionId: 'user-123',
  userQuery: 'I need a moisturiser for dry skin',
  existingProfile: {            // optional — pre-populate from session store
    country: 'UK',
    skinType: 'dry',
  },
});

console.log(result.finalRecommendations);
```

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
| `claude-3-5-haiku` | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-sonnet-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `gemini-2.0-flash` | Google | `GEMINI_API_KEY` |
| `gemini-2.5-pro` | Google | `GEMINI_API_KEY` |
| `grok-3` | xAI | `XAI_API_KEY` |
| `grok-3-mini` | xAI | `XAI_API_KEY` |
| `groq-llama-3.3-70b` | Groq | `GROQ_API_KEY` |
| `groq-llama-3.1-8b` | Groq | `GROQ_API_KEY` |

Switch models by setting `LLM_MODEL` to any name from the table above. Only the API key for the chosen provider is required.
