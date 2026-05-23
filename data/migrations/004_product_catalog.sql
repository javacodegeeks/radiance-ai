CREATE TABLE products (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 VARCHAR(500) NOT NULL,
  brand                VARCHAR(255),
  inci                 TEXT[],
  categories           TEXT[],
  country_availability TEXT[],
  source_url           VARCHAR(1000),
  -- 1536 dims = OpenAI text-embedding-3-small / ada-002
  embedding            vector(1536),
  is_pre_vetted        BOOLEAN NOT NULL DEFAULT FALSE,
  cached_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_saved_products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  VARCHAR(255) NOT NULL REFERENCES user_sessions (session_id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, product_id)
);

-- IVFFlat index for ANN cosine search (tune `lists` for dataset size)
CREATE INDEX idx_products_embedding ON products
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_products_brand   ON products (brand);
CREATE INDEX idx_products_country ON products USING gin (country_availability);
