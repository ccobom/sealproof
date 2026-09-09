ALTER TABLE temporary_releases ADD COLUMN storage_format TEXT NOT NULL DEFAULT 'PLAINTEXT_V0'
  CHECK (storage_format IN ('PLAINTEXT_V0', 'ENCRYPTED_V1'));
ALTER TABLE temporary_releases ADD COLUMN pdf_envelope_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE temporary_releases ADD COLUMN pdf_key_version TEXT NOT NULL DEFAULT '';
ALTER TABLE temporary_releases ADD COLUMN pdf_document_iv TEXT NOT NULL DEFAULT '';
ALTER TABLE temporary_releases ADD COLUMN pdf_wrapped_key_iv TEXT NOT NULL DEFAULT '';
ALTER TABLE temporary_releases ADD COLUMN pdf_wrapped_data_key TEXT NOT NULL DEFAULT '';
ALTER TABLE temporary_releases ADD COLUMN stored_ciphertext_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE temporary_releases ADD COLUMN stored_ciphertext_hash TEXT NOT NULL DEFAULT '';

CREATE TRIGGER require_encrypted_pdf_insert
BEFORE INSERT ON temporary_releases
WHEN NEW.storage_format != 'ENCRYPTED_V1'
  OR NEW.pdf_envelope_version != 1
  OR length(NEW.pdf_key_version) NOT BETWEEN 1 AND 128
  OR length(NEW.pdf_document_iv) < 1
  OR length(NEW.pdf_wrapped_key_iv) < 1
  OR length(NEW.pdf_wrapped_data_key) < 1
  OR NEW.stored_ciphertext_size <= 0
  OR length(NEW.stored_ciphertext_hash) != 64
  OR NEW.stored_ciphertext_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'new releases require encrypted PDF storage');
END;

CREATE TRIGGER preserve_encrypted_pdf_metadata
BEFORE UPDATE OF storage_format, pdf_envelope_version, pdf_key_version, pdf_document_iv,
  pdf_wrapped_key_iv, pdf_wrapped_data_key, stored_ciphertext_size, stored_ciphertext_hash
ON temporary_releases
BEGIN
  SELECT RAISE(ABORT, 'encrypted PDF metadata is immutable');
END;
