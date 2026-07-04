CREATE TABLE IF NOT EXISTS safety_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient    VARCHAR(255) NOT NULL,
  contraindication VARCHAR(255) NOT NULL,
  severity      VARCHAR(20)  NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  notes         TEXT,
  source        VARCHAR(500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingredient, contraindication)
);

CREATE INDEX IF NOT EXISTS idx_safety_rules_ingredient        ON safety_rules (ingredient);
CREATE INDEX IF NOT EXISTS idx_safety_rules_contraindication  ON safety_rules (contraindication);
