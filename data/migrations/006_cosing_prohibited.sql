-- EU CosIng Annex II — substances prohibited outright in cosmetic products.
-- No concentration/usage-condition columns (unlike Annex III/IV/V) since
-- these substances aren't permitted under any condition. One row per
-- (substance, reference number), identified by chemical name/INN — see
-- data/pipeline/07-load-cosing-prohibited.ts for why this isn't exploded
-- across the "Identified INGREDIENTS" example members.
CREATE TABLE IF NOT EXISTS cosing_prohibited_substances (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient        TEXT NOT NULL,
  reference_number  VARCHAR(20)  NOT NULL,
  regulation        VARCHAR(255),
  cmr               VARCHAR(100),
  source            VARCHAR(500) NOT NULL DEFAULT 'EU CosIng Annex II',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient, reference_number)
);

CREATE INDEX IF NOT EXISTS idx_cosing_prohibited_ingredient ON cosing_prohibited_substances (ingredient);
