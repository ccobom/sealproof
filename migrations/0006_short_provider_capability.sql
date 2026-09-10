ALTER TABLE delivery_attempts ADD COLUMN provider_capability_hash TEXT;

CREATE TRIGGER validate_provider_capability_hash_insert
BEFORE INSERT ON delivery_attempts
WHEN NEW.provider_capability_hash IS NOT NULL
  AND (
    length(NEW.provider_capability_hash) != 64
    OR NEW.provider_capability_hash GLOB '*[^0-9a-f]*'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid provider capability hash');
END;

CREATE TRIGGER validate_provider_capability_hash_update
BEFORE UPDATE OF provider_capability_hash ON delivery_attempts
WHEN NEW.provider_capability_hash IS NOT NULL
  AND (
    length(NEW.provider_capability_hash) != 64
    OR NEW.provider_capability_hash GLOB '*[^0-9a-f]*'
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid provider capability hash');
END;

CREATE UNIQUE INDEX delivery_attempts_provider_capability_hash
  ON delivery_attempts(provider_capability_hash)
  WHERE provider_capability_hash IS NOT NULL;
