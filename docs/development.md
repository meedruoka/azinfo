# Development

How to build, run, test and release azinfo. For what the extension does and how to audit it, see the [README](../README.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm dev:edge` | Dev build with hot reload; opens Chrome / Edge with the extension loaded |
| `pnpm build:local` / `pnpm build:local:edge` | One-off build with the pinned dev ID, no dev server, in `.output/chrome-mv3-dev` / `.output/edge-mv3-dev`. Load it with "Load unpacked" in your own browser |
| `pnpm build` / `pnpm build:edge` | Production build in `.output/chrome-mv3` / `.output/edge-mv3` |
| `pnpm zip` / `pnpm zip:edge` | Store-ready zip |
| `pnpm check:manifest` | Checks the built production manifests against the spec's permissions (run after both builds) |
| `pnpm render:icons` | Renders `assets-src/icon.svg` to `public/icon/*.png` and `store/logo-300.png` with headless Edge. Slow on this machine; about a minute per size |
| `pnpm store:shots` | Store screenshots (1280×800, light and dark) of the real UI with invented sample data, in `store/screenshots/`. Uses headless Edge. The page also takes `?lang=<locale>` (e.g. `ar`) to check a language and its direction |
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
| Chrome Web Store | `agbbplllbldedlebmjoplcjilocgphia` | `https://agbbplllbldedlebmjoplcjilocgphia.chromiumapp.org/` (on the production registration) |
| Edge Add-ons | `boklcincembcnlpajejonihmapalfedi` (CRX ID; Store ID `0RDCKGFWV30T`) | `https://boklcincembcnlpajejonihmapalfedi.chromiumapp.org/` (on the production registration) |

The dev ID is pinned by the manifest `key` in `wxt.config.ts`, added in development
mode only. The private half of that key is in `.keys/` (git-ignored); it is only
needed for packing a `.crx`, never for the ID itself.

Dev builds also get `tabs`, `scripting` and `http://localhost/*` from WXT for hot
reload. Production builds contain only the permissions in the spec.

## Sign-in setup

Create an Entra app registration and a `.env.local` as described in
[docs/entra-setup.md](entra-setup.md). Design decision:
[docs/decisions/001-auth.md](decisions/001-auth.md).

Settings (tenant, cache duration, spike threshold, clear cached data) are on the
options page: popup → **Options**.

## Docs

| Document | Contents |
|---|---|
| [docs/entra-setup.md](entra-setup.md) | App registration, tenant setting, admin consent, production registration |
| [docs/admin-consent.md](admin-consent.md) | For tenant administrators: what azinfo asks for and how to approve, limit or remove it |
| [docs/permissions.md](permissions.md) | Every permission and host, with store justifications |
| [docs/privacy-policy.md](privacy-policy.md) | Privacy policy, published at <https://meedruoka.github.io/azinfo/privacy-policy.html> by the Pages workflow |
| [docs/store-listing.md](store-listing.md) | Listing text, screenshot checklist, release checklist, publisher verification risk |
| [docs/decisions/](decisions/) | 001 sign-in platform, 002 cost query, 003 multi-tenant, 004 Advisor tips and meter breakdown, 005 languages, 006 personal accounts, 007 five more languages and right-to-left |

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push to `main` and every pull
request: frozen install, `lint`, `compile`, `test`, both production builds and `check:manifest`.
CI has no `.env` files, so its builds contain no Entra client ID: store packages are always built
locally with `.env.production.local`. pnpm is pinned by `packageManager` in `package.json`.
Actions are pinned to commit SHAs (the comment names the tag), because the release workflow holds
the Edge API key: update a pin deliberately, after reading that action's changes.

## Releasing (CD)

[.github/workflows/release.yml](../.github/workflows/release.yml) builds both store packages from
`main` and uploads them through the
[Edge Add-ons API v1.1](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)
and the [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api). It only
runs when started by hand: **Actions → Release → Run workflow**, choosing **both**, **edge** or
**chrome**. By default it only uploads; tick **publish** to submit for review (Edge sends
[store/certification-notes.txt](../store/certification-notes.txt)). Both packages are also kept as a
workflow artifact, with `SHA256SUMS.txt`. The Chrome upload still runs if the Edge one fails.

Every run signs a build provenance attestation for both zips
([actions/attest-build-provenance](https://github.com/actions/attest-build-provenance)). A run
with **publish** also creates the GitHub Release `v<version>` (zips and checksums attached) once
the store submissions succeed, so a version can only be published once: the run stops early if
that release already exists. Check a zip with
`gh attestation verify azinfo-<version>-chrome.zip -R meedruoka/azinfo`.

Settings (repository **Settings → Secrets and variables → Actions**, or `gh`):

| Name | Kind | Value |
|---|---|---|
| `ENTRA_CLIENT_ID` | variable | `e76d6bcf-bcea-4d90-a659-2d47135dfa96` (production registration) |
| `EDGE_CLIENT_ID` | secret | Partner Center → Microsoft Edge → Publish API → Client ID |
| `EDGE_API_KEY` | secret | Same page, the API key. **It expires**: Partner Center shows the date; renew it and update the secret |
| `EDGE_PRODUCT_ID` | variable | `bcaf0d3a-73c3-4fa7-8067-83f2dc349b14` |
| `CHROME_SERVICE_ACCOUNT_KEY` | secret | The whole JSON key file of the Google service account (setup below) |
| `CHROME_PUBLISHER_ID` | variable | Chrome Developer Dashboard → Publisher → Settings → Publisher ID |
| `CHROME_ITEM_ID` | variable | `agbbplllbldedlebmjoplcjilocgphia` |

**Current choice (2026-11-20): Chrome uploads stay manual.** Setting up Google Cloud asked for a
payment card, so the Google setup below hasn't been done and **Release** defaults to **edge**.
For Chrome, upload `azinfo-<version>-chrome.zip` from the run's **store-packages** artifact (or
`.output/`) in the Chrome Developer Dashboard and submit it. The Chrome step stays in the
workflow, ready if this changes.

### One-time Google setup (Chrome)

The Chrome Web Store API v2 accepts a **service account**, which suits CI: no browser sign-in and
no refresh token that can lapse.

1. [Google Cloud console](https://console.cloud.google.com/): create a project (for example
   `azinfo-release`), then **APIs & Services → Library → Chrome Web Store API → Enable**.
2. **IAM & Admin → Service accounts → Create service account** (for example `azinfo-release`).
   Give it **no** roles.
3. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
4. [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Account**: add
   the service account's e-mail (`…@….iam.gserviceaccount.com`). One per publisher.
5. Same dashboard → **Publisher → Settings**: copy the **Publisher ID**.
6. Store them, then delete the downloaded key file:
   ```
   gh secret set CHROME_SERVICE_ACCOUNT_KEY --repo meedruoka/azinfo < path\to\key.json
   gh variable set CHROME_PUBLISHER_ID --repo meedruoka/azinfo --body <publisher ID>
   gh variable set CHROME_ITEM_ID --repo meedruoka/azinfo --body agbbplllbldedlebmjoplcjilocgphia
   ```

The key doesn't expire by itself: to rotate it, add a new key, update the secret, delete the old
key in Google Cloud. If the item's visibility is changed in the dashboard, publish once by hand
before the API can publish again (Google's rule).

### Each release

Bump `version` in `package.json`, push to `main`, wait for CI, run **Release** (first without
**publish**, then with it). Both stores reject a version they already have. Edge refuses a new
submission while one is in review (`InProgressSubmission`). Locally,
`node scripts/edge-publish.mjs --dry-run` and `node scripts/chrome-publish.mjs --dry-run` check
the settings without calling either store.

## Development rule

Develop and test only against a personal Azure subscription and a personal Entra
app registration.
