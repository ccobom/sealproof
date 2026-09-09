ALTER TABLE delivery_attempts ADD COLUMN provider_ticket_envelope TEXT;

CREATE TRIGGER validate_provider_ticket_envelope_insert
BEFORE INSERT ON delivery_attempts
WHEN NEW.provider_ticket_envelope IS NOT NULL
  AND length(NEW.provider_ticket_envelope) NOT BETWEEN 1 AND 4096
BEGIN
  SELECT RAISE(ABORT, 'invalid provider ticket envelope');
END;

CREATE TRIGGER validate_provider_ticket_envelope_update
BEFORE UPDATE OF provider_ticket_envelope ON delivery_attempts
WHEN NEW.provider_ticket_envelope IS NOT NULL
  AND length(NEW.provider_ticket_envelope) NOT BETWEEN 1 AND 4096
BEGIN
  SELECT RAISE(ABORT, 'invalid provider ticket envelope');
END;
