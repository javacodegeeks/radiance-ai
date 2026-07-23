-- EU CosIng Annex III — substances cosmetic products must not contain except
-- subject to the restrictions laid down (concentration limits, mandatory
-- warnings, usage conditions). One row per (ingredient name variant,
-- Annex III entry) — an entry (e.g. "Thioglycolic acid and its salts") lists
-- several specific INCI names, each of which needs its own matchable row.
CREATE TABLE IF NOT EXISTS cosing_restrictions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient        VARCHAR(255) NOT NULL,
  reference_number  VARCHAR(20)  NOT NULL,
  restriction_scope TEXT,
  max_concentration TEXT,
  conditions_text   TEXT,
  regulation        VARCHAR(255),
  cmr               VARCHAR(50),
  source            VARCHAR(500) NOT NULL DEFAULT 'EU CosIng Annex III',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient, reference_number)
);

CREATE INDEX IF NOT EXISTS idx_cosing_restrictions_ingredient ON cosing_restrictions (ingredient);
