PRAGMA foreign_keys = ON;

CREATE TABLE audit_releases (
  transaction_id TEXT PRIMARY KEY
    CHECK (length(transaction_id) BETWEEN 16 AND 128),
  document_hash TEXT NOT NULL
    CHECK (length(document_hash) = 64 AND document_hash NOT GLOB '*[^0-9a-f]*'),
  hash_algorithm TEXT NOT NULL
    CHECK (hash_algorithm = 'SHA-256'),
  workflow_version TEXT NOT NULL
    CHECK (length(workflow_version) BETWEEN 1 AND 64),
  finalized_at INTEGER NOT NULL,
  release_state TEXT NOT NULL
    CHECK (release_state IN (
      'FINALIZING',
      'SEALED_AWAITING_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED',
      'DELIVERY_UNRESOLVED',
      'CLOSED'
    )),
  production_delivery_outcome TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (production_delivery_outcome IN ('PENDING', 'DELIVERED', 'FAILED', 'UNRESOLVED')),
  signer_delivery_outcome TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (signer_delivery_outcome IN ('PENDING', 'DELIVERED', 'FAILED', 'UNRESOLVED')),
  failure_category TEXT
    CHECK (failure_category IS NULL OR failure_category IN (
      'delivery_bounced',
      'provider_submission_failed',
      'expired_delivery_unresolved',
      'conflicting_provider_events',
      'cleanup_failed',
      'unknown_failure'
    )),
  closeout_reason TEXT
    CHECK (closeout_reason IS NULL OR closeout_reason IN (
      'production_closeout',
      'download_and_delete',
      'automatic_expiry'
    )),
  cleanup_outcome TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (cleanup_outcome IN ('PENDING', 'COMPLETED', 'FAILED')),
  cleanup_completed_at INTEGER,
  audit_expires_at INTEGER,
  CHECK (
    (cleanup_outcome = 'COMPLETED' AND cleanup_completed_at IS NOT NULL AND audit_expires_at > cleanup_completed_at)
    OR
    (cleanup_outcome != 'COMPLETED' AND cleanup_completed_at IS NULL AND audit_expires_at IS NULL)
  )
) STRICT;

CREATE TABLE temporary_releases (
  transaction_id TEXT PRIMARY KEY
    REFERENCES audit_releases(transaction_id) ON DELETE CASCADE,
  envelope_version INTEGER NOT NULL CHECK (envelope_version = 1),
  key_version TEXT NOT NULL CHECK (length(key_version) BETWEEN 1 AND 128),
  envelope_iv TEXT NOT NULL,
  email_ciphertext TEXT NOT NULL,
  wrapped_key_iv TEXT NOT NULL,
  wrapped_data_key TEXT NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  status_capability_hash TEXT NOT NULL UNIQUE
    CHECK (length(status_capability_hash) = 64 AND status_capability_hash NOT GLOB '*[^0-9a-f]*'),
  download_capability_hash TEXT NOT NULL UNIQUE
    CHECK (length(download_capability_hash) = 64 AND download_capability_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at INTEGER NOT NULL,
  cleanup_started_at INTEGER,
  CHECK (expires_at > 0)
) STRICT;

CREATE TABLE delivery_attempts (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL
    REFERENCES temporary_releases(transaction_id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('PRODUCTION', 'SIGNER')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  provider_message_id TEXT UNIQUE,
  delivery_state TEXT NOT NULL
    CHECK (delivery_state IN (
      'PENDING_SUBMISSION',
      'ACCEPTED',
      'DELAYED',
      'DELIVERED',
      'FAILED',
      'UNRESOLVED_CONFLICT'
    )),
  provider_event_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (transaction_id, recipient_role, attempt_number)
) STRICT;

CREATE TABLE processed_webhooks (
  svix_id TEXT PRIMARY KEY CHECK (length(svix_id) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL
    CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  transaction_id TEXT NOT NULL
    REFERENCES temporary_releases(transaction_id) ON DELETE CASCADE,
  delivery_attempt_id INTEGER NOT NULL
    REFERENCES delivery_attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'email.sent',
      'email.delivery_delayed',
      'email.delivered',
      'email.failed',
      'email.bounced'
    )),
  received_at INTEGER NOT NULL
) STRICT;

CREATE INDEX delivery_attempts_transaction_role
  ON delivery_attempts(transaction_id, recipient_role, attempt_number DESC);

CREATE INDEX temporary_releases_expiry
  ON temporary_releases(expires_at);

CREATE INDEX audit_releases_expiry
  ON audit_releases(audit_expires_at)
  WHERE audit_expires_at IS NOT NULL;
