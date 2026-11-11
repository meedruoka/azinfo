# Store listing and release checklist

Draft text for the Chrome Web Store and Microsoft Edge Add-ons. Fields marked **verify** have
limits or wording that should be checked against the store's form when submitting.

## Listing text

**Name:** azinfo

**Summary** (manifest `description`, max 132 characters; currently 103):

> Azure cost info next to the resource you are viewing in the Azure portal. Not affiliated with Microsoft.

**Languages:** the summary above is translated in the package (`extDescription` in `public/_locales/<lang>/messages.json`) for 10 languages. Each store also asks for the description per language: translate it from the text below (see decision 005).

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
> • Some organisations require an administrator to approve the app the first time
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

**Privacy policy URL:** host `docs/privacy-policy.md` publicly first (for example GitHub Pages)
and fill in its placeholders.

## Images

| Asset | Chrome Web Store | Edge Add-ons | Source |
|---|---|---|---|
| Icon | 128×128 (from the package) | 128×128 (from the package) | `public/icon/128.png` |
| Store logo | — | 300×300, **verify** | `store/logo-300.png` |
| Screenshots | 1280×800 or 640×400, 1–5 | 640×480 or 1280×800, **verify**, up to 10 | Capture, see below |
| Small promo tile | 440×280 (optional) | — | Not made yet |

`pnpm render:icons` regenerates the icon and store logo from `assets-src/icon.svg`.

### Screenshot checklist

Use a **personal test subscription** only: no employer tenant names, resource names or costs.
Make the browser window 1280×800, light theme first, and capture one in dark theme too.

1. [ ] Resource page with the panel **expanded**: this month, projection, last month, change.
2. [ ] Resource page with a **spike flag** (needs at least 5 completed days in the month and a
   resource whose spend has jumped).
3. [ ] Resource group page: the **resource list** with the group total.
4. [ ] Toolbar **popup** with the top 5 for a subscription.
5. [ ] **Collapsed pill** in the corner of a normal portal blade, to show how unobtrusive it is.
6. [ ] (Optional) **Options page**.

Check every screenshot for: tenant domain in the portal header, account e-mail, subscription IDs
in the address bar, and real customer or company names.

## Release checklist

### One-time setup

1. [ ] **Production app registration**, separate from the dev one, in your own tenant:
   - Name `azinfo`, multi-tenant (*Any Microsoft Entra ID tenant*)
   - Platform **Single-page application**
   - API permission *Azure Service Management → user_impersonation*; remove *Microsoft Graph → User.Read*
   - No client secret
   - See [entra-setup.md](entra-setup.md)
2. [ ] **`.env.production.local`** (git-ignored). It overrides `.env.local`, which Vite also
   loads for production builds:
   ```
   WXT_ENTRA_CLIENT_ID=<production client ID>
   WXT_ENTRA_AUTHORITY=organizations
   ```
   Without the second line, a production build silently inherits the dev authority
   (`meedakourgmail.onmicrosoft.com`) from `.env.local`.
3. [ ] **Store accounts:** Chrome Web Store developer account (one-time fee) and Microsoft Partner
   Center account for Edge Add-ons.
4. [ ] **Get each store's extension ID:** upload a first draft package, then copy the item ID.
   - Chrome: shown in the developer dashboard after the draft upload.
   - Edge: shown in Partner Center after creating the extension.
5. [ ] **Add both redirect URIs** to the production registration under *Single-page application*:
   `https://<chrome-store-id>.chromiumapp.org/` and `https://<edge-store-id>.chromiumapp.org/`.
   **Verify** the Edge one after the first install from the store: open the extension's service
   worker console and run `chrome.identity.getRedirectURL()`.
6. [ ] **Privacy policy** published at a public URL, placeholders filled in.
7. [ ] **Administrator page** [admin-consent.md](admin-consent.md) published next to it, with
   `<CLIENT_ID>` and `<CHROME_STORE_ID>` replaced by the production values. Link it from the
   store description's "Requirements" line.

### Each release

1. [ ] Bump `version` in `package.json`.
2. [ ] `pnpm lint && pnpm test`
3. [ ] `pnpm build && pnpm build:edge && pnpm check:manifest`
4. [ ] Confirm the production bundle uses the **production** client ID:
   `grep -c <production-client-id> .output/chrome-mv3/background.js` should be 1.
5. [ ] `pnpm zip && pnpm zip:edge`, then upload the zips from `.output/`.
6. [ ] After store approval: install from the store, sign in with a personal account (tenant
   setting) and a work account (`organizations`), and open a resource page.

## Known adoption risk: publisher verification

On the consent screen, Entra marks multi-tenant apps from **unverified publishers** as
"unverified". Many organisations only let users consent to apps from verified publishers, or to
no apps at all. Work-account users there will see an *"admin approval required"* message, and a
tenant administrator must grant consent once for the whole organisation (instructions for them:
[admin-consent.md](admin-consent.md)).

Becoming a **verified publisher** removes most of this friction. It needs a Microsoft AI Cloud
Partner Program (formerly MPN) account linked to the app registration. Personal Microsoft accounts
aren't affected. This isn't required to publish; decide before promoting azinfo to companies.
