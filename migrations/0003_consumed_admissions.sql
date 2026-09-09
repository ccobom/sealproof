CREATE TABLE consumed_admissions (
  admission_id TEXT PRIMARY KEY
    CHECK (length(admission_id) = 36),
  transaction_id TEXT NOT NULL UNIQUE
    REFERENCES temporary_releases(transaction_id) ON DELETE CASCADE,
  consumed_at INTEGER NOT NULL CHECK (consumed_at >= 0)
) STRICT;
