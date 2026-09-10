ALTER TABLE delivery_attempts ADD COLUMN submission_failure_category TEXT
  CHECK (submission_failure_category IS NULL OR submission_failure_category IN (
    'attachment_preparation_failed',
    'provider_authentication',
    'provider_invalid_request',
    'provider_rate_limited',
    'provider_unavailable',
    'provider_malformed_response',
    'provider_submission_failed'
  ));

ALTER TABLE delivery_attempts ADD COLUMN submission_failed_at INTEGER
  CHECK (submission_failed_at IS NULL OR submission_failed_at >= 0);

CREATE INDEX delivery_attempts_pending_submission_failure
  ON delivery_attempts(transaction_id, recipient_role, submission_failure_category)
  WHERE delivery_state = 'PENDING_SUBMISSION';
