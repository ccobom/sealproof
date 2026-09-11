# Email Authentication Baseline — September 11, 2026

## Purpose

This record documents the public email-related DNS state observed for
`sealproof.app` after adding a monitoring-only DMARC policy. It contains no
recipient addresses, message contents, provider identifiers, or secret values.

## Public DNS evidence

Read-only DNS lookups returned the following records:

| Purpose | DNS name | Observed value |
|---|---|---|
| Cloudflare Email Routing SPF | `sealproof.app` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| DMARC | `_dmarc.sealproof.app` | `v=DMARC1; p=none;` |
| Incoming mail route | `sealproof.app` | `route1.mx.cloudflare.net` (priority 37) |
| Incoming mail route | `sealproof.app` | `route2.mx.cloudflare.net` (priority 8) |
| Incoming mail route | `sealproof.app` | `route3.mx.cloudflare.net` (priority 80) |

The DMARC lookup was repeated after the DNS change and returned the exact
monitoring-only policy shown above.

## Provider-side evidence

Resend reports `sealproof.app` as a verified sending domain. A prior live
happy-path test also delivered separate messages from the configured
`releases@sealproof.app` sender to both test recipients. Those observations
provide functional evidence that the provider's sending-domain setup,
including DKIM, was operating for that test.

The exact provider-supplied DKIM DNS record is not copied into this document.
It should be reviewed in the Resend domain dashboard and must not be replaced
with a guessed selector or value.

## Interpretation

- The existing root SPF record supports Cloudflare Email Routing and was not
  modified or duplicated.
- `p=none` asks receivers to evaluate DMARC without asking them to quarantine
  or reject messages that fail.
- No aggregate-report destination (`rua`) is configured yet. This avoids
  directing machine-generated reports into the releases inbox or disclosing
  them to an unreviewed reporting service.
- DMARC improves authentication policy and visibility, but it does not
  guarantee inbox placement or prove delivery of any individual message.

## Future hardening gate

Before changing the policy to `quarantine` or `reject`:

1. inventory every legitimate sender for `sealproof.app`;
2. establish a deliberately chosen DMARC-report destination;
3. review aggregate results for SPF/DKIM alignment failures; and
4. confirm that Resend and any other approved sender consistently align.

Enforcement is not authorized by this evidence record.
