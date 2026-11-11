# Permissions

azinfo asks for the minimum the spec allows. `pnpm build && pnpm build:edge && pnpm check:manifest`
verifies the built manifests, and `tests/manifest.test.ts` checks the config on every test run.

## Production manifest

| Entry | Value |
|---|---|
| `permissions` | `identity`, `storage` |
| `host_permissions` | `https://portal.azure.com/*`, `https://management.azure.com/*`, `https://login.microsoftonline.com/*` |
| Content script | `https://portal.azure.com/*` only |
| `key` | Development builds only (pins the dev extension ID); absent from store builds |
| `optional_*`, `web_accessible_resources`, `externally_connectable` | None |
| Content Security Policy | Manifest V3 default; no remote code |

## Justifications

These are worded for the Chrome Web Store and Edge Add-ons justification fields.

**identity**
: Signs the user in with their Microsoft account through `chrome.identity.launchWebAuthFlow`
  (OAuth 2.0 authorization code with PKCE). It's needed to call Azure's cost API on the user's
  behalf. azinfo never reads the Azure portal's own sign-in or cookies.

**storage**
: Keeps sign-in tokens in memory-only session storage (cleared when the browser closes). Also
  keeps cached cost figures and the user's settings in local storage so the cost API isn't queried
  on every page view. The user can clear cached data on the options page.

**https://portal.azure.com/\***
: Runs the content script that reads the current page address to identify the Azure resource or
  resource group being viewed, and shows the cost panel next to it. It reads only the URL and
  doesn't read or change the portal's page content.

**https://management.azure.com/\***
: Calls Azure Resource Manager read operations: the tenant and subscription lists (GET), Azure
  Advisor's cost recommendations (GET) and the Cost Management query (the only POST, which is
  read-only by design). No other Azure operation is ever called.

**https://login.microsoftonline.com/\***
: Exchanges the sign-in code for tokens and refreshes them at Microsoft Entra ID's token endpoint.

## What azinfo does not request

- No `tabs`, `scripting`, `cookies`, `webRequest` or `declarativeNetRequest`. The dev server adds
  `tabs` and `scripting` to development builds only, for hot reload.
- No access to any other site.
- No remote code: everything is bundled at build time.
