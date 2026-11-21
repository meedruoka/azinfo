# azinfo

A browser extension for Chrome and Edge that shows what an Azure resource costs, right next to it
in the Azure portal: this month, last month, what the cost is made of, and Azure Advisor's savings
tips.

- [Chrome Web Store](https://chromewebstore.google.com/detail/agbbplllbldedlebmjoplcjilocgphia)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/boklcincembcnlpajejonihmapalfedi)
- [Privacy policy](https://meedruoka.github.io/azinfo/privacy-policy.html) ·
  [For administrators](https://meedruoka.github.io/azinfo/admin-consent.html) ·
  [Issues](https://github.com/meedruoka/azinfo/issues)

azinfo is an independent tool. It isn't affiliated with or endorsed by Microsoft.

## Checking the code

This README is written for people who want to check what azinfo does before installing it, or
before approving it for their organisation. In short:

- **No server.** There's no backend and no analytics. The extension only talks to Microsoft.
- **Read-only.** It calls read operations only. It never changes anything in Azure.
- **Your own permissions.** It signs in as you and sees only what your Azure roles already let you
  see.
- **Small surface.** Two browser permissions (`identity`, `storage`) and three hosts.

### Where it connects

These are the only network calls in the code. You can confirm it with
`grep -rn "fetch(" lib entrypoints`.

| Host | What for | Code |
|---|---|---|
| `login.microsoftonline.com` | Sign-in (OAuth 2.0 authorization code with PKCE) and token refresh | [lib/auth/token-endpoint.ts](lib/auth/token-endpoint.ts), [lib/auth/authorize.ts](lib/auth/authorize.ts) |
| `management.azure.com` | Tenants, subscriptions, Advisor tips (GET) and the Cost Management query (POST, read-only) | [lib/azure/arm-client.ts](lib/azure/arm-client.ts), [lib/azure/cost-client.ts](lib/azure/cost-client.ts) |
| `portal.azure.com` | Not called. The content script runs here and reads only the page address, to know which resource you're viewing | [lib/portal/parse-portal-url.ts](lib/portal/parse-portal-url.ts) |

### Permissions

| Manifest entry | Value |
|---|---|
| `permissions` | `identity`, `storage` |
| `host_permissions` | `https://portal.azure.com/*`, `https://management.azure.com/*`, `https://login.microsoftonline.com/*` |
| Content script | `https://portal.azure.com/*` only |
| Remote code | None. Everything is bundled at build time, under the default Manifest V3 content security policy |

There's no `tabs`, `cookies`, `webRequest`, `scripting` or access to any other site. Every entry
is explained in [docs/permissions.md](docs/permissions.md). `pnpm check:manifest` fails the build
if the built manifest asks for anything else.

### What it stores

| Data | Where | Kept until |
|---|---|---|
| Sign-in tokens | `chrome.storage.session` (memory only) | The browser closes or you sign out |
| Cost figures, Advisor tips, your tenant and subscription names and IDs | `chrome.storage.local` | The cache period ends (4 hours by default), you sign out, or you clear it on the options page |
| Settings, and which account signed in (so Microsoft can sign you in again without asking) | `chrome.storage.local` | You change them, sign out or uninstall |

Nothing leaves your browser except the calls to Microsoft listed above. The full detail is in the
[privacy policy](docs/privacy-policy.md).

### Where to start reading

| Path | What's there |
|---|---|
| [entrypoints/background.ts](entrypoints/background.ts) | The service worker: handles every request, holds the sign-in |
| [lib/sender-policy.ts](lib/sender-policy.ts) | What the in-portal panel is allowed to ask the worker for, and from which origin |
| [lib/auth/](lib/auth/) | Sign-in, PKCE, token storage and refresh |
| [lib/azure/](lib/azure/) | The Azure API clients |
| [lib/cost/](lib/cost/) | Building the cost query and shaping the results |
| [entrypoints/content/](entrypoints/content/) | The panel shown inside the Azure portal |
| [entrypoints/popup/](entrypoints/popup/), [entrypoints/options/](entrypoints/options/) | The toolbar popup and the settings page |
| [docs/decisions/](docs/decisions/) | Why things are built the way they are (sign-in, cost query, tenants, and more) |

Tests sit next to the code (`*.test.ts`). They run with [MSW](https://mswjs.io/), which fails any
network request a test didn't mock.

## How releases are built

1. Every push and pull request runs [CI](.github/workflows/ci.yml): lint, type check, tests, both
   production builds and the manifest check.
2. A release is started by hand from `main` only, with the
   [Release workflow](.github/workflows/release.yml). It runs the same checks again, builds the
   Chrome and Edge packages, and uploads them to the stores through their APIs.
3. Each store reviews the package before anyone gets the update.

Every third-party GitHub Action is pinned to a commit SHA, dependencies install from the locked
`pnpm-lock.yaml`, and the store keys are repository secrets that only the release workflow reads.
The built packages are kept as a workflow artifact for 30 days.

### Comparing a store package with this code

There are no signed build attestations yet, so you can't prove that a store package came from a
given commit. You can still compare them yourself:

1. Check out the commit that set the version you installed (`version` in `package.json`).
2. Build with the production sign-in settings, which aren't secret:
   ```sh
   pnpm install --frozen-lockfile
   WXT_ENTRA_CLIENT_ID=e76d6bcf-bcea-4d90-a659-2d47135dfa96 WXT_ENTRA_AUTHORITY=organizations pnpm build
   ```
3. Compare `.output/chrome-mv3/` with the installed extension's folder (`chrome://extensions` with
   developer mode on shows its ID; the files are in your browser profile under `Extensions/<id>/`).
   The stores add their own files, such as `_metadata/`, so leave those out.

Builds haven't been checked to be byte-for-byte identical across machines yet. If you find a
difference, please [open an issue](https://github.com/meedruoka/azinfo/issues).

## Building it yourself

You need Node.js 24 and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm test
pnpm build        # Chrome, in .output/chrome-mv3
pnpm build:edge   # Edge, in .output/edge-mv3
```

To sign in from your own build, you need your own Entra app registration. Everything else
(commands, dev setup, the release process) is in [docs/development.md](docs/development.md).

## Reporting a problem

For bugs and questions, [open an issue](https://github.com/meedruoka/azinfo/issues). For a
security problem, please use
[private vulnerability reporting](https://github.com/meedruoka/azinfo/security/advisories/new)
instead of a public issue.
