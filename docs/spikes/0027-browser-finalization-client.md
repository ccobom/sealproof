# 0027 — Browser Finalization Client Boundary

- Date: September 9, 2026
- Result: Typed, disconnected browser transport added

## Question

Can the reviewed browser PDF be connected to the anonymous admission and raw-upload boundaries without yet enabling transmission from the interface?

## Boundary

The browser client has two explicit operations. The first sends the two delivery addresses, reviewed document hash, and Turnstile proof to the same-origin admission route. The second sends the exact reviewed PDF bytes as a raw `application/pdf` body with the encrypted ticket in the `Authorization` header.

Both requests omit browser credentials, disable caching, refuse redirects, and use relative same-origin URLs. Zod treats both server responses as untrusted. The upload result is rejected unless the server returns the same document hash the browser supplied. Server error bodies are not exposed through the client error, limiting accidental display or logging of internal details.

## Scope

This client is deliberately disconnected from the React interface. No button can invoke it, no Turnstile widget is loaded, no live endpoint is configured, and no document or personal information is transmitted by this change.

## Next gate

Mount the admission and ticket-finalization handlers in a production-shaped local Worker entry point. Then test this client against that local Worker using synthetic data before adding a real sealing action to the interface.
