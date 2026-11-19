# azinfo

Browser extension (Chrome + Edge, Manifest V3) that shows Azure cost info next to
the resource you are viewing in the Azure portal. Read-only, no backend.
Not affiliated with Microsoft.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm dev:edge` | Dev build with hot reload; opens Chrome / Edge with the extension loaded |
| `pnpm build:local` / `pnpm build:local:edge` | One-off build with the pinned dev ID, no dev server, in `.output/chrome-mv3-dev` / `.output/edge-mv3-dev`. Load it with "Load unpacked" in your own browser |
| `pnpm build` / `pnpm build:edge` | Production build in `.output/chrome-mv3` / `.output/edge-mv3` |
| `pnpm zip` / `pnpm zip:edge` | Store-ready zip |
| `pnpm check:manifest` | Checks the built production manifests against the spec's permissions (run after both builds) |
| `pnpm render:icons` | Renders `assets-src/icon.svg` to `public/icon/*.png` and `store/logo-300.png` with headless Edge. Slow on this machine; about a minute per size |
| `pnpm test` | Vitest (MSW blocks any unmocked network request) |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm compile` | TypeScript type check |

`pnpm dev:edge` needs a git-ignored `web-ext.config.ts` with the Edge binary path:

```ts
import { defineWebExtConfig } from 'wxt';
export default defineWebExtConfig({
  binaries: { edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
});
```

## Extension IDs and redirect URIs

| Build | Extension ID | Redirect URI |
|---|---|---|
| Dev (unpacked, `pnpm dev`) | `jojhniohldijhpnpeihdnffjflgcpnpb` | `https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/` |
| Chrome Web Store | assigned at first upload | TBD |
| Edge Add-ons | assigned at first upload | TBD |

The dev ID is pinned by the manifest `key` in `wxt.config.ts`, added in development
mode only. The private half of that key is in `.keys/` (git-ignored); it is only
needed for packing a `.crx`, never for the ID itself.

Dev builds also get `tabs`, `scripting` and `http://localhost/*` from WXT for hot
reload. Production builds contain only the permissions in the spec.

## Sign-in setup

Create an Entra app registration and a `.env.local` as described in
[docs/entra-setup.md](docs/entra-setup.md). Design decision:
[docs/decisions/001-auth.md](docs/decisions/001-auth.md).

Settings (tenant, cache duration, spike threshold, clear cached data) are on the
options page: popup → **Options**.

## Docs

| Document | Contents |
|---|---|
| [docs/entra-setup.md](docs/entra-setup.md) | App registration, tenant setting, admin consent, production registration |
| [docs/admin-consent.md](docs/admin-consent.md) | For tenant administrators: what azinfo asks for and how to approve, limit or remove it |
| [docs/permissions.md](docs/permissions.md) | Every permission and host, with store justifications |
| [docs/privacy-policy.md](docs/privacy-policy.md) | Privacy policy, published at <https://akourmohamed.github.io/azinfo-site/privacy-policy.html> (copy changes to the `azinfo-site` repo) |
| [docs/store-listing.md](docs/store-listing.md) | Listing text, screenshot checklist, release checklist, publisher verification risk |
| [docs/decisions/](docs/decisions/) | 001 sign-in platform, 002 cost query, 003 multi-tenant, 004 Advisor tips and meter breakdown, 005 languages |

## Development rule

Develop and test only against a personal Azure subscription and a personal Entra
app registration.
