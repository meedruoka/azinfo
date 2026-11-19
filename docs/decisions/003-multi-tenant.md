# 003: One sign-in for all tenants

- **Status:** Implemented. The cross-tenant behaviour is waiting for a manual test with a second
  personal tenant.
- **Date:** 2026-10-05

## Context

Users who work in several Entra tenants had to change the tenant on the options page, which signs
them out, every time they switched. The Azure portal itself lets one sign-in reach every tenant
("Switch directory").

## What the documentation says

Checked 2026-10-04/05:

- [Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens):
  "Refresh tokens are bound to a combination of user and client, but aren't tied to a resource or
  tenant. A client can use a refresh token to acquire access tokens across any combination of
  resource and tenant where it has permission to do so."
- [Tenants - List](https://learn.microsoft.com/en-us/rest/api/resources/tenants/list)
  (`2022-12-01`): returns `tenantId`, `displayName`, `defaultDomain`, `domains` and
  `tenantCategory` (`Home`, `ProjectedBy`, `ManagedBy`).
- SPA refresh tokens expire 24 hours after sign-in (decision 001); tokens obtained for other
  tenants carry the same expiry.

## Decision

1. **One sign-in** through the configured authority, then **one access token per tenant** in
   session storage. The refresh token is shared, and the newest one is kept (Entra rotates them).
   Session writes are queued so parallel tenants can't overwrite each other.
2. **Order per tenant:** cached token → refresh at that tenant → `prompt=none` at that tenant →
   `TenantSignInRequiredError`. That error is shown as "Sign in to this tenant": one interactive
   sign-in for that tenant only. A refusal by another tenant never ends the home session.
3. **Directory:** `GET /tenants` with the default token. Subscriptions are then listed per
   `Home`-category tenant with that tenant's token, 4 tenants at a time, and cached with the cost
   TTL. Each subscription remembers the tenant that listed it (`accessTenantId`). Lighthouse
   subscriptions are therefore queried through the managing tenant, not their own `tenantId`, where
   the user usually has no account. `ProjectedBy` / `ManagedBy` tenants get no token request.
4. **Panel routing:** directory tenant for the subscription → the portal URL's `#@<tenant>`,
   matched against tenant IDs and domains or used as the authority directly → the configured
   authority. A directory failure only logs a warning, so the single-tenant case keeps working.
5. The options-page tenant becomes "Sign in through tenant": the starting point, not a switch.

## Expected behaviour still to confirm

| # | Check | Result |
|---|---|---|
| 1 | After sign-in, the popup lists the second tenant's subscriptions grouped under it, without another sign-in, or with one "Sign in" click for that tenant the first time (consent) | Pending (not tested: needs the popup) |
| 2 | In the token endpoint traffic, tenant B's token comes from a `refresh_token` grant at `/<tenant B>/` | Probably failed, unconfirmed (2026-11-19): the tenant-B panel asked for a sign-in instead of getting a token silently. This may only be the first-time consent; confirm in the service worker's Network tab when clicking "Sign in to this tenant" |
| 3 | The panel on a tenant-B resource page shows cost, switching between tenants without sign-out | Partly passed (2026-11-19): a resource in a guest tenant was routed to that tenant (from `#@<domain>`) and showed "needs you to sign in once" with "Sign in to this tenant", not an error. No cost shown because that sign-in was not done. Back on a home-tenant resource, the panel showed cost and meter breakdown without sign-out |
| 4 | Sign out clears all tenants; signing in again restores them | Pending (not tested: needs the popup) |

Tested read-only in Chrome with a work account that reaches three tenants (home plus two guest
tenants); nothing was signed in or consented to during the test.

**If check 2 fails** (no silent cross-tenant token with SPA refresh tokens), the fallback already in
place is the per-tenant `prompt=none` or one click per tenant per day. Record the result here.

## Consequences

- The first popup open after sign-in makes 1 + N requests (tenants, then subscriptions per tenant),
  then nothing more until the TTL expires.
- The first sign-in to each tenant needs one interactive consent there, unless an administrator of
  that tenant has already consented.
- No new permissions or hosts.
