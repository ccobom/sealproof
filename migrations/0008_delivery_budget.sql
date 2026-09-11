-- Aggregate-only accounting survives release cleanup.
CREATE TABLE delivery_budget_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  attempt_limit INTEGER NOT NULL CHECK (attempt_limit BETWEEN 1 AND 90)
);
INSERT INTO delivery_budget_policy VALUES (1, 90);

CREATE TABLE delivery_budget (
  reserved_at INTEGER PRIMARY KEY CHECK (reserved_at >= 0),
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);

-- This runs before the insert's UPSERT, so NEW.attempts is the increment,
-- including when several reservations share the same millisecond.
CREATE TRIGGER enforce_delivery_budget BEFORE INSERT ON delivery_budget
BEGIN
  SELECT CASE WHEN COALESCE((
    SELECT SUM(attempts) FROM delivery_budget
    WHERE reserved_at > NEW.reserved_at - 86400000
  ), 0) + NEW.attempts > COALESCE((
    SELECT attempt_limit FROM delivery_budget_policy WHERE id = 1
  ), 0) THEN RAISE(ABORT, 'DELIVERY_BUDGET_EXHAUSTED') END;
END;

-- Initial role inserts share the batch transaction with ticket consumption.
-- A retry insert and this reservation are one atomic statement.
CREATE TRIGGER reserve_delivery_attempt AFTER INSERT ON delivery_attempts
BEGIN
  INSERT INTO delivery_budget VALUES (NEW.created_at, 1)
    ON CONFLICT(reserved_at) DO UPDATE SET attempts = attempts + 1;
END;

ALTER TABLE delivery_attempts ADD COLUMN submission_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_attempts ADD COLUMN submission_call_at INTEGER;

-- Existing attempts have no reservation in this new ledger. Their next call
-- must reserve capacity, even if they have never reached the provider.
UPDATE delivery_attempts SET submission_calls = 1;

CREATE TRIGGER reserve_repeated_submission BEFORE UPDATE OF submission_calls ON delivery_attempts
WHEN NEW.submission_calls > OLD.submission_calls AND OLD.submission_calls > 0
BEGIN
  INSERT INTO delivery_budget VALUES (NEW.submission_call_at, 1)
    ON CONFLICT(reserved_at) DO UPDATE SET attempts = attempts + 1;
END;
