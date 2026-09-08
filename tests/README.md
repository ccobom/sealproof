# Tests

This directory contains executable evidence for approved product behavior and technical claims.

`worker/document.test.ts` currently proves that the local Workers runtime can return a readable PDF and that an independent SHA-256 calculation matches the hash returned with those exact bytes. It also confirms that the spike route is not exposed at unrelated paths.

Tests should be organized around claims such as:

- both recipients receive the same finalized document bytes;
- the stored hash matches those bytes;
- signing capabilities expire and cannot be reused improperly;
- unapproved personal data is not retained;
- deletion occurs under both success and failure conditions;
- delivery acceptance, delivery confirmation, and bounce are represented accurately.

Passing a spike test validates only its named technical claim. It does not establish that the production workflow, security model, delivery lifecycle, retention behavior, or Cloudflare plan limits have been implemented or verified.
