# Store listing and release checklist

Draft text for the Chrome Web Store and Microsoft Edge Add-ons. Fields marked **verify** have
limits or wording that should be checked against the store's form when submitting.

## Listing text

**Name:** azinfo

**Summary** (manifest `description`, max 132 characters; currently 103):

> Azure cost info next to the resource you are viewing in the Azure portal. Not affiliated with Microsoft.

**Languages:** the summary above is translated in the package (`extDescription` in `public/_locales/<lang>/messages.json`) for 15 languages (decisions 005 and 007). Each store also asks for the description per language: translate it from the text below.

**Category:** Developer Tools (Chrome) / Developer tools (Edge). **Verify** that the category
exists.

**Description:**

> See what an Azure resource costs without leaving the page you're on.
>
> azinfo adds a small panel to the Azure portal. Open any resource and it shows:
> • cost this month so far, and last month
> • projected month-end cost
> • a spike flag when the projection is well above last month (threshold is configurable)
> • what this month's cost is made of, by meter (compute, storage, bandwidth…)
> • Azure Advisor's savings tips for the resource, with estimated savings
>
> Open a resource group and you get every resource in it, sorted by this month's cost, with the
> group total.
>
> The toolbar popup lists the five most expensive resources in a subscription.
>
> Private by design
> • No server: data goes straight from Microsoft to your browser and stays there.
> • No analytics, tracking or ads.
> • Read-only: azinfo never changes anything in Azure.
> • Sign-in tokens are kept in memory only.
>
> Requirements
> • A Microsoft work, school or personal account with access to an Azure subscription
> • The Cost Management Reader role (or Reader, Contributor or Owner) on the subscription
> • Personal Microsoft accounts: choose "Personal Microsoft account" when signing in
> • Work and school accounts: your administrator may need to approve azinfo once for your
>   organisation: https://akourmohamed.github.io/azinfo-site/admin-consent.html
>
> Cost figures come from Azure Cost Management, which updates every few hours. Use Cost analysis
> in the portal for invoices and detailed reporting.
>
> azinfo is an independent tool and isn't affiliated with or endorsed by Microsoft. Azure is a
> trademark of the Microsoft group of companies.

**Single purpose** (Chrome privacy tab):

> Show Azure cost information for the resource or resource group the user is viewing in the Azure
> portal.

**Permission justifications:** copy from [permissions.md](permissions.md).

**Remote code:** No.

**Data usage** (Chrome privacy tab). **Verify** the categories against the current form. Proposed
answers, conservatively:

| Category | Handled? | Note |
|---|---|---|
| Authentication information | Yes | Microsoft sign-in tokens, kept in memory only and sent only to Microsoft |
| Financial and payment information | Yes | Azure cost figures, cached on the device, never sent to the developer |
| Website content | No | Only the portal URL is read, not page content |
| All others | No | |

Certify all three: not sold to third parties; not used for unrelated purposes; not used for
creditworthiness or lending.

**Privacy policy URL:** <https://akourmohamed.github.io/azinfo-site/privacy-policy.html>

It's published from the public repo `AkourMohamed/azinfo-site` (GitHub Pages, branch `main`).
`docs/privacy-policy.md` here is the source: after changing it, copy it to that repo, update the
date, and push. Support channel: <https://github.com/AkourMohamed/azinfo-site/issues>.

## Images

| Asset | Chrome Web Store | Edge Add-ons | Source |
|---|---|---|---|
| Icon | 128×128 (from the package) | 128×128 (from the package) | `public/icon/128.png` |
| Store logo | — | 300×300, **verify** | `store/logo-300.png` |
| Screenshots | 1280×800 or 640×400, 1–5 | 640×480 or 1280×800, **verify**, up to 10 | Capture, see below |
| Small promo tile | 440×280 (optional) | — | Not made yet |

`pnpm render:icons` regenerates the icon and store logo from `assets-src/icon.svg`.

### Screenshot checklist

The screenshots in `store/screenshots/` (1280×800, light and dark) come from `pnpm store:shots`.
It renders azinfo's real panel, popup and options components with **invented sample data**
(`scripts/store-shots/data.ts`: shop-web, rg-shop-prod, USD amounts, all-zero IDs) on a neutral
backdrop, not the Azure portal, and captures them with headless Edge. No real tenant, account,
subscription or cost can appear, and the page never reads the `.env` files. A personal
subscription was too empty for useful shots (all $0.00), and employer tenants are off-limits.
Re-run after any UI change.

1. [x] Resource page with the panel **expanded**: `1-resource-*.png`
2. [x] Resource page with a **spike flag**: `2-spike-*.png`
3. [x] Resource group: the **resource list** with the group total: `3-group-*.png`
4. [x] Toolbar **popup** with the top 5 for a subscription: `4-popup-*.png`
5. [x] **Collapsed pill** in the corner of a page: `5-pill-*.png`
6. [x] (Optional) **Options page**: `6-options-*.png`

Chrome takes up to 5: use 1–5 in light. Edge takes up to 10: use all six light ones, and add dark
ones if wanted. Reviewed 2026-11-19 for tenant domains, e-mails, IDs and real company names: none.

## Release checklist

### One-time setup

1. [x] **Production app registration**, separate from the dev one, in your own tenant:
   - Name `azinfo`, multi-tenant (*Any Microsoft Entra ID tenant*)
   - Platform **Single-page application**
   - API permission *Azure Service Management → user_impersonation*; remove *Microsoft Graph → User.Read*
   - No client secret
   - See [entra-setup.md](entra-setup.md)

   Done 2026-11-19 in the personal Default Directory: client ID
   `e76d6bcf-bcea-4d90-a659-2d47135dfa96`. The portal now calls this account type *Multiple Entra
   ID tenants* → **Allow all tenants** (not the "certain tenants" preview). The SPA platform is
   added together with the redirect URIs in step 5, since the portal needs a URI for it.
2. [x] **`.env.production.local`** (git-ignored). It overrides `.env.local`, which Vite also
   loads for production builds:
   ```
   WXT_ENTRA_CLIENT_ID=<production client ID>
   WXT_ENTRA_AUTHORITY=organizations
   ```
   Without the second line, a production build silently inherits the dev authority
   (the developer's own tenant) from `.env.local`.
3. [ ] **Store accounts:** Chrome Web Store developer account (one-time fee) and Microsoft Partner
   Center account for Edge Add-ons.
4. [ ] **Get each store's extension ID:** upload a first draft package, then copy the item ID.
   Chrome: `agbbplllbldedlebmjoplcjilocgphia` (draft uploaded 2026-11-19). Edge: CRX ID
   `boklcincembcnlpajejonihmapalfedi`, Store ID `0RDCKGFWV30T`, Product ID
   `bcaf0d3a-73c3-4fa7-8067-83f2dc349b14` (draft 2026-11-20). The redirect URI uses the CRX ID.
   - Chrome: shown in the developer dashboard after the draft upload.
   - Edge: shown in Partner Center after creating the extension.
5. [ ] **Add both redirect URIs** to the production registration under *Single-page application*:
   `https://<chrome-store-id>.chromiumapp.org/` and `https://<edge-store-id>.chromiumapp.org/`.
   **Verify** the Edge one after the first install from the store: open the extension's service
   worker console and run `chrome.identity.getRedirectURL()`.
   Chrome URI added 2026-11-19, Edge URI 2026-11-20 (Single-page application platform, no
   implicit grant).
6. [x] **Privacy policy** published at a public URL, placeholders filled in (2026-11-19, see
   "Privacy policy URL" above).
7. [x] **Administrator page** [admin-consent.md](admin-consent.md) published next to it, with
   `<CLIENT_ID>` and `<CHROME_STORE_ID>` replaced by the production values. Link it from the
   store description's "Requirements" line.

   Live 2026-11-20 at <https://akourmohamed.github.io/azinfo-site/admin-consent.html> (copy of
   `docs/admin-consent.md`; copy it again after changes). Linked from the Chrome description
   since 0.1.1; the Edge description still needs the same Requirements lines at its next edit.

### Each release

1. [ ] Bump `version` in `package.json`.
2. [ ] `pnpm lint && pnpm test`
3. [ ] `pnpm build && pnpm build:edge && pnpm check:manifest`
4. [ ] Confirm the production bundle uses the **production** client ID:
   `grep -c <production-client-id> .output/chrome-mv3/background.js` should be 1.
5. [ ] `pnpm zip && pnpm zip:edge`, then upload the zips from `.output/`. Edge can instead go
   through **Actions → Release** (see the README), and Chrome too once its service account is
   set up.

### Releases

| Version | Edge | Chrome |
|---|---|---|
| 0.1.0 | Submitted 2026-11-20 by hand, approved | Submitted 2026-11-20 by hand, published 2026-11-20 |
| 0.1.1 | Submitted 2026-11-20 through Release to Edge (submission 1152921505702463722), approved and live (store data reports version 0.1.1). Decision 006 browser checks were skipped before submitting | Submitted 2026-11-20 by hand, with the updated Requirements lines (personal accounts, admin page link) |
| 0.1.2 | Submitted 2026-11-20 through Release (submission 1152921505702464017), then cancelled the same day in Partner Center at the user's request: it shouldn't have been submitted without an explicit go-ahead. 0.1.1 stays live | Waiting for the 0.1.1 review to finish, then upload by hand |
6. [ ] After store approval: install from the store, sign in with a personal account (tenant
   setting) and a work account (`organizations`), and open a resource page.

## Known adoption risk: publisher verification

On the consent screen, Entra marks multi-tenant apps from **unverified publishers** as
"unverified". Work-account users will see an *"admin approval required"* message, and a tenant
administrator must grant consent once for the whole organisation (instructions for them:
[admin-consent.md](admin-consent.md)).

This is likely to hit **most** organisations, not only strict ones: when the production
registration was created (2026-11-19), its overview page said *"End users cannot grant consent to
newly registered multitenant apps without verified publishers."* The dev registration (October
2026) was refused the same way by one guest tenant during testing. Not yet confirmed with the
production registration in a real work tenant.

Becoming a **verified publisher** removes most of this friction. It needs a Microsoft AI Cloud
Partner Program (formerly MPN) account linked to the app registration. Personal Microsoft accounts
aren't affected. It isn't required to publish, but without it, work accounts will mostly depend on
their administrators; decide before promoting azinfo to companies.
