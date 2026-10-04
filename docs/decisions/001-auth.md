# 001: Entra redirect URI platform for sign-in

- **Status:** Accepted: SPA platform
- **Date:** 2026-10-04

## Context

The extension signs in with OAuth 2.0 authorization code + PKCE through
`chrome.identity.launchWebAuthFlow`. The background service worker redeems the
code and refreshes tokens with `fetch` to
`login.microsoftonline.com/{authority}/oauth2/v2.0/token`. Tokens are kept
only in `chrome.storage.session`.

The redirect URI (`https://<extension-id>.chromiumapp.org/`) can be registered
in Entra under two platforms, and Entra treats token requests differently for
each.

## What the documentation says

Checked 2026-10-04.

| | SPA platform | Mobile and desktop (public client) |
|---|---|---|
| Token request **with** an `Origin` header | Required | Rejected: *"Cross-origin token redemption is permitted only for the 'Single-Page Application' client-type"* (AADSTS9002326) |
| Token request **without** an `Origin` header | Rejected | Accepted |
| Refresh token lifetime | **24 hours, fixed.** Refreshed tokens keep the original expiry | **90 days**, renewed on each use |

Sources:

- [OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow):
  "the Microsoft identity platform returns an error if you attempt to use a
  `spa` redirect URI without an `Origin` header", and "For refresh tokens sent
  to a redirect URI registered as `spa`, the refresh token expires after 24
  hours".
- [Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens):
  "24 hours for single-page applications … 90 days for all other scenarios".

So the deciding question is whether a `fetch` POST from the extension's
service worker carries an `Origin` header. If it does, as the Fetch spec
suggests for POST requests, the public-client option only works if that header
is removed. That needs the `declarativeNetRequest` permission, which the spec
doesn't allow without asking first.

## Test results

Tested 2026-10-04 on the same build with two registrations,
`azinfo (dev, SPA)` and `azinfo (dev, public)`, in a personal tenant with a
personal Microsoft account and a tenant-specific authority.

| # | Check | SPA | Public client |
|---|---|---|---|
| 1 | Interactive sign-in completes, subscriptions listed | Pass | **Fail**: token request rejected (below) |
| 2 | Token request carries `Origin`? | Yes: `chrome-extension://jojhniohldijhpnpeihdnffjflgcpnpb`, HTTP 200 | Yes, same header, HTTP 400 |
| 3 | Access-token refresh (forced by editing `expiresAt`) | Pass: one `token` request, 200 | Not reachable |
| 4 | Browser restart → silent or one-click sign-in | Pass | Not reachable |
| 5 | Sign out → stays signed out, no `token` request on reopen | Pass | Not reachable |
| 6 | Edge (same unpacked ID) | Pass | Not tested |

Public-client error, verbatim:

> invalid_request: AADSTS9002326: Cross-origin token redemption is permitted
> only for the 'Single-Page Application' client-type. Request origin:
> 'chrome-extension://jojhniohldijhpnpeihdnffjflgcpnpb'.

The service worker's `fetch` always sends the `Origin` header, and extension
code cannot remove it.

## Decision

Register the redirect URI under the **Single-page application** platform.

The public-client option would only work by stripping `Origin` with
`declarativeNetRequest`. That adds a permission the spec doesn't allow without
asking, and it works around a check Entra applies deliberately. A longer-lived
refresh token isn't worth that.

## Consequences

- Refresh tokens expire 24 hours after sign-in, and refreshing doesn't extend
  that. After that, `getAccessToken` falls back to a silent `prompt=none` flow,
  which succeeds while the user's Microsoft session cookie exists. Otherwise
  the popup shows **Sign in**, and one click is enough.
- No permission beyond `identity` and `storage` is needed for sign-in.
- Each store build adds its own `https://<id>.chromiumapp.org/` redirect URI
  to the same registration, under the SPA platform.
- The `azinfo (dev, public)` registration can be deleted.
