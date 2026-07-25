-- EU CosIng "allowed with conditions" annexes — Annex III (restricted
-- substances), Annex IV (colorants), Annex V (preservatives). All three
-- share the same shape: a substance is permitted, subject to a maximum
-- concentration / usage scope / mandatory warnings. One row per (substance,
-- annex, reference number) — identified by the substance's own INCI/Common
-- Ingredients Glossary name (falling back to its chemical name/INN), NOT
-- exploded across the individual member ingredients an entry's "Identified
-- INGREDIENTS or substances e.g." column lists as examples (a member
-- ingredient can belong to several different substances, each with its own
-- distinct restriction).
--
-- See data/migrations/006_cosing_prohibited.sql for Annex II (substances
-- prohibited outright — a stronger signal, kept in a separate table).
CREATE TABLE IF NOT EXISTS cosing_restrictions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient        VARCHAR(255) NOT NULL,
  annex             VARCHAR(10)  NOT NULL,
  reference_number  VARCHAR(20)  NOT NULL,
  restriction_scope TEXT,
  max_concentration TEXT,
  conditions_text   TEXT,
  regulation        VARCHAR(255),
  cmr               VARCHAR(50),
  source            VARCHAR(500) NOT NULL DEFAULT 'EU CosIng',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient, annex, reference_number)
);

CREATE INDEX IF NOT EXISTS idx_cosing_restrictions_ingredient ON cosing_restrictions (ingredient);
