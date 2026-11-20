# 006: Sign-in for personal Microsoft accounts

- **Status:** Implemented in 0.1.1, live on Edge. Checks 1, 2 and 5 passed on the Edge store version (2026-11-20); 3 and 4 not yet done.
- **Date:** 2026-11-20

## Problem

Store builds sign in through `organizations`. The first store install (Edge, 2026-11-20) showed
that a personal Microsoft account is refused there: *"You can't sign in here with a personal
account. Use your work or school account instead."* It worked only after setting the personal
tenant (`<name>.onmicrosoft.com`) on the options page, which the popup never mentioned. Dev builds
hid this because `.env.local` sets the developer's own tenant as the default.

There is no single authority for both kinds of account:

- `organizations` accepts any work or school account without knowing its tenant, but no personal
  account.
- A personal account has Azure only in its own tenant, a different one per person.
- `common` sends a personal account to the consumers tenant, which holds no Azure subscriptions
  (and the production registration accepts organisational accounts only).

## Options considered

| Option | Verdict |
|---|---|
| A. Always sign in through the tenant in the portal URL (`#@<tenant>`) | Rejected. A work user viewing a guest tenant would sign in there, not at home, and hit that tenant's consent policy. Seen on 2026-11-19: a guest tenant answered "Approval required". |
| B. `common` | Doesn't work for personal accounts (see above). |
| C. The user says which kind of account; the tenant comes from the portal | **Chosen.** One click more, no guessing. |

## Decision

1. **Sign-in asks for the account type** when no tenant is set on the options page:
   **Work or school account** (signs in through the build default, `organizations`) or
   **Personal Microsoft account** (signs in through the user's own tenant).
2. **The personal tenant comes from the portal.**
   - Panel: the tenant in the page's address (`#@<tenant>`). Without one there, the panel only
     offers the work-account button and points to the popup.
   - Popup: the last tenant seen in a portal address this browser session, pre-filled in a
     tenant field the user can edit; empty when none was seen, with help text saying where to
     find it.
3. **Precedence of the sign-in authority:** the options-page setting, then the tenant chosen for
   a personal sign-in, then the build default. A tenant set on the options page means no choice
   is shown: one Sign in button, as before.
4. **Storage.**
   - `local:auth.signInAuthority`: the tenant of the last personal sign-in, so the silent
     sign-in after a browser restart uses the same tenant. Removed on sign-out, on a work sign-in
     and when the options-page setting changes. A tenant domain or ID, no account data.
   - `session:portal.lastTenant`: the last tenant seen in a portal address, in memory only.
5. **Switching authority signs the old session out first**, as changing the setting already did:
   tokens belong to the authority that issued them.

## Checks

Test build that behaves like the store default (dev registration and ID, default `organizations`):
`WXT_ENTRA_AUTHORITY=organizations pnpm build:local`. An environment variable overrides `.env.local`.

| # | Check | Result |
|---|---|---|
| 1 | Personal account, panel on a resource page: "Personal Microsoft account" signs in with no options-page change | Passed 2026-11-20, Edge store 0.1.1 (reported by the user) |
| 2 | Personal account, popup after visiting a resource page: tenant pre-filled, sign-in works | Passed 2026-11-20, Edge store 0.1.1 (reported by the user) |
| 3 | Work account: "Work or school account" signs in through `organizations`, all tenants listed as before | Pending |
| 4 | Browser restart after a personal sign-in: still signed in, silently | Failed 2026-11-20 on the Edge store version: signed out after the restart. Tokens are in session storage by design (decision 001), so the restart relies on a silent `prompt=none` sign-in, which needs Microsoft's sign-in cookie; likely gone (not confirmed: the reason wasn't captured). The popup then doesn't offer the remembered personal tenant |
| 5 | Sign out, then the choice is offered again | Passed 2026-11-20, Edge store 0.1.1 (reported by the user) |

## Addendum: after the session ends (0.1.2, 2026-11-20)

Check 4 failed for both a personal and a work account: closing Edge signed the user out. Tokens
are in session storage by design (decision 001); after a restart the worker tries a silent
`prompt=none` sign-in, which only works while Microsoft's own sign-in cookie survives (it doesn't
without "Stay signed in", and possibly not with several accounts signed in). Edge on the test PC
has no clear-on-exit policy or setting. Keeping tokens on disk was not chosen: these refresh
tokens expire after 24 hours anyway, so it would weaken the privacy promise for little gain.

0.1.2:

1. When the user was signed in and never signed out (`local:auth.signedInIntent`), the popup
   shows **Sign in again (`<tenant>`)** for a personal account, or **Sign in again (work or
   school account)**: one click with the same account. **Use another account** opens the usual
   choice, with the remembered tenant pre-filled.
2. A failed silent sign-in is logged in the service worker console: `[azinfo] silent sign-in
   failed: <reason> <Microsoft's description>`. No token is ever logged.

Still open: whether "Stay signed in → Yes" makes restarts silent, and if several signed-in
accounts break the silent sign-in. If so, remember the account's sign-in name and pass it as
`login_hint` (a privacy-policy change, since it stores the account name).

## Consequences

- One extra click for work accounts (choosing the type), in exchange for personal accounts
  working without visiting the options page.
- No new permission or host. The portal address was already read for the panel.
