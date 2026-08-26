-- EU CosIng Functions glossary (~83 ingredient function categories, e.g.
-- UV FILTER, EXFOLIATING, SKIN CONDITIONING) and the ingredients that carry
-- each function, pulled from the "search-api" backend documented in
-- docs/specs/cosing-functions-classification-enrichment.md and captured by
-- data/pipeline/fetch-cosing-search-api.sh into functions.json (api1) and
-- data/pipeline/ingredients-by-function/*.json (api2-all, one file per
-- function, 83 files).
--
-- Source shape notes that drove this design:
--   * Each ingredient's `metadata.functionName` is a string array — one
--     ingredient can carry several functions (max observed: 15) — hence the
--     ingredient_function join table below, rather than a single FK column.
--   * `metadata.substanceId` is present on every ingredient record, always
--     numeric, and identical across every per-function file an ingredient
--     appears in (confirmed empirically) — it's the natural key deduping the
--     83 overlapping per-function pulls down to one row per real ingredient.
--   * `metadata.casNo` is a single string but packs multiple CAS Registry
--     numbers separated by " / " (e.g. "10279-57-9 / 1343-98-2") — split into
--     ingredient_cas_number rather than kept as one denormalized string, so
--     "find ingredient by CAS number" is a plain indexed lookup.
--   * `metadata.identifiedIngredient` lists other ingredients' substanceIds
--     that this record identifies/groups (up to 25 observed) — modeled as a
--     self-referential ingredient_identified_component table. No FK is
--     placed on the component side: ~936 of the referenced substanceIds
--     never appear in this dataset (they belong to substances outside the
--     83 active, function-tagged ingredients this crawl covers), so a hard
--     FK would reject otherwise-valid rows.
--   * `metadata.sccsOpinion` (opinion titles) and `metadata.sccsOpinionUrls`
--     (their PDF links) look like parallel arrays but are NOT reliably the
--     same length per record (68 of 439 records with opinions mismatch) —
--     kept as two independent ordinal-indexed tables instead of one paired
--     table, to avoid inventing a pairing the source data doesn't guarantee.
--   * `database`/`databaseLabel` are missing on ~7% of ingredient records
--     (newer, 2026-ingested entries per the enrichment doc) — kept nullable.
--   * Internal search-api/ES bookkeeping fields (esST_*, esDA_*, checksum,
--     weight, corporate-search-version, contentType, ...) carry no business
--     meaning for the classifier this data feeds — kept as one JSONB
--     envelope column per row (source_document) for audit/traceability
--     instead of exploding each into its own column.

CREATE TABLE IF NOT EXISTS cosing_function (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  function_id           INTEGER NOT NULL,
  function_name         VARCHAR(255) NOT NULL,
  function_description  TEXT,
  source_reference      UUID NOT NULL,
  source_document       JSONB NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (function_id),
  UNIQUE (function_name)
);

CREATE TABLE IF NOT EXISTS ingredient (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  substance_id                  BIGINT NOT NULL,
  source_reference              UUID NOT NULL,
  inci_name                     TEXT NOT NULL,
  common_glossary_name          TEXT NOT NULL,
  inn_name                      VARCHAR(500),
  inci_usa_name                 TEXT,
  chemical_name                 TEXT,
  chemical_description          TEXT,
  ph_eur_name                   VARCHAR(500),
  ec_no                         TEXT,
  cosmetic_restriction          TEXT,
  classification_information    TEXT,
  other_regulations             TEXT,
  note                          TEXT,
  status                        VARCHAR(50) NOT NULL DEFAULT 'Active',
  perfuming                     BOOLEAN,
  official_journal_publication  BOOLEAN,
  current_version               SMALLINT,
  database_code                 VARCHAR(50),
  database_label                VARCHAR(255),
  source_document               JSONB NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (substance_id),
  UNIQUE (source_reference)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_inci_name ON ingredient (inci_name);
CREATE INDEX IF NOT EXISTS idx_ingredient_ec_no ON ingredient (ec_no);

-- Many-to-many: one row per (ingredient, function) pair this crawl observed
-- — this is the core enrichment signal (e.g. "does this ingredient carry
-- EXFOLIATING or KERATOLYTIC?") consumed by the category classifier.
CREATE TABLE IF NOT EXISTS ingredient_function (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  function_id             INTEGER NOT NULL REFERENCES cosing_function (function_id) ON DELETE CASCADE,
  PRIMARY KEY (ingredient_substance_id, function_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_function_function_id ON ingredient_function (function_id);

-- One row per CAS Registry Number packed into metadata.casNo.
CREATE TABLE IF NOT EXISTS ingredient_cas_number (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  ordinal                 SMALLINT NOT NULL,
  cas_number              VARCHAR(40) NOT NULL,
  PRIMARY KEY (ingredient_substance_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_cas_number_cas_number ON ingredient_cas_number (cas_number);

-- Self-referential: substances this ingredient record identifies/groups
-- (metadata.identifiedIngredient). No FK on component_substance_id — see
-- header note on the ~936 components that fall outside this dataset.
CREATE TABLE IF NOT EXISTS ingredient_identified_component (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  ordinal                 SMALLINT NOT NULL,
  component_substance_id  BIGINT NOT NULL,
  PRIMARY KEY (ingredient_substance_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_identified_component_component_id ON ingredient_identified_component (component_substance_id);

-- metadata.sccsOpinion — SCCS opinion titles. Kept separate from the URLs
-- table below rather than paired: the two arrays aren't reliably the same
-- length per source record (see header note).
CREATE TABLE IF NOT EXISTS ingredient_sccs_opinion (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  ordinal                 SMALLINT NOT NULL,
  opinion_text            TEXT NOT NULL,
  PRIMARY KEY (ingredient_substance_id, ordinal)
);

-- metadata.sccsOpinionUrls — SCCS opinion PDF links.
CREATE TABLE IF NOT EXISTS ingredient_sccs_opinion_url (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  ordinal                 SMALLINT NOT NULL,
  opinion_url             TEXT NOT NULL,
  PRIMARY KEY (ingredient_substance_id, ordinal)
);

-- metadata.otherRestrictions — free-text restriction notes (max 2 observed).
CREATE TABLE IF NOT EXISTS ingredient_other_restriction (
  ingredient_substance_id BIGINT NOT NULL REFERENCES ingredient (substance_id) ON DELETE CASCADE,
  ordinal                 SMALLINT NOT NULL,
  restriction_text        TEXT NOT NULL,
  PRIMARY KEY (ingredient_substance_id, ordinal)
);
