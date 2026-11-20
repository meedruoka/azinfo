# Chrome Web Store form: values to paste

Item `agbbplllbldedlebmjoplcjilocgphia` (azinfo). Dashboard: <https://chrome.google.com/webstore/devconsole>.
Same answers as the Edge submission of 2026-11-20. Long-form source: `docs/store-listing.md`.

## Store listing tab

**Description**

```
See what an Azure resource costs without leaving the page you're on.

azinfo adds a small panel to the Azure portal. Open any resource and it shows:
• cost this month so far, and last month
• projected month-end cost
• a spike flag when the projection is well above last month (threshold is configurable)
• what this month's cost is made of, by meter (compute, storage, bandwidth…)
• Azure Advisor's savings tips for the resource, with estimated savings

Open a resource group and you get every resource in it, sorted by this month's cost, with the group total.

The toolbar popup lists the five most expensive resources in a subscription.

Private by design
• No server: data goes straight from Microsoft to your browser and stays there.
• No analytics, tracking or ads.
• Read-only: azinfo never changes anything in Azure.
• Sign-in tokens are kept in memory only.

Requirements
• A Microsoft work, school or personal account with access to an Azure subscription
• The Cost Management Reader role (or Reader, Contributor or Owner) on the subscription
• Work and school accounts: your administrator may need to approve azinfo once for your organisation

Cost figures come from Azure Cost Management, which updates every few hours. Use Cost analysis in the portal for invoices and detailed reporting.

azinfo is an independent tool and isn't affiliated with or endorsed by Microsoft. Azure is a trademark of the Microsoft group of companies.
```

| Field | Value |
|---|---|
| Category | Developer Tools |
| Language | English |
| Store icon (128×128) | `public\icon\128.png` |
| Screenshots (1280×800, max 5) | `store\screenshots\1-resource-light.png` … `5-pill-light.png` |
| Small promo tile (440×280) | empty unless required |
| Homepage URL | `https://akourmohamed.github.io/azinfo-site/` |
| Support URL | `https://github.com/AkourMohamed/azinfo-site/issues` |
| Official URL | empty |
| Mature content | No |

## Privacy tab

**Single purpose**

```
Show Azure cost information for the resource or resource group the user is viewing in the Azure portal.
```

**identity justification**

```
Signs the user in with their Microsoft account through chrome.identity.launchWebAuthFlow (OAuth 2.0 authorization code with PKCE). It's needed to call Azure's cost API on the user's behalf. azinfo never reads the Azure portal's own sign-in or cookies.
```

**storage justification**

```
Keeps sign-in tokens in memory-only session storage (cleared when the browser closes). Also keeps cached cost figures and the user's settings in local storage so the cost API isn't queried on every page view. The user can clear cached data on the options page.
```

**Host permission justification**

```
https://portal.azure.com/*: runs the content script that reads the current page address to identify the Azure resource or resource group being viewed, and shows the cost panel next to it. It reads only the URL and doesn't read or change the portal's page content.
https://management.azure.com/*: calls Azure Resource Manager read operations only: the tenant and subscription lists, Azure Advisor's cost recommendations, and the Cost Management query (a read-only POST). No other Azure operation is ever called.
https://login.microsoftonline.com/*: exchanges the sign-in code for tokens and refreshes them at Microsoft Entra ID's token endpoint.
```

| Field | Value |
|---|---|
| Remote code | No |
| Data usage | Authentication information; Financial and payment information. Nothing else |
| Certifications | all three (read them first: you are the one certifying) |
| Privacy policy URL | `https://akourmohamed.github.io/azinfo-site/privacy-policy.html` |

**Test instructions** (if the form has this field)

```
azinfo shows Azure cost data inside the Azure portal (portal.azure.com). It is read-only and has no backend server.

No test account is provided. Testing needs a Microsoft account with access to an Azure subscription and at least the Cost Management Reader (or Reader) role on it. A free Azure account works; with no spending, costs show as 0.00.

How to test:
1. Click the azinfo toolbar icon and choose Sign in. A Microsoft sign-in window opens (chrome.identity.launchWebAuthFlow, OAuth 2.0 with PKCE). Work or school accounts may see a consent screen, or "Approval required" if their organisation only allows admin-approved apps; personal Microsoft accounts are not affected. For a personal account, first set the tenant on the options page (popup > Options), e.g. yourname.onmicrosoft.com.
2. The popup then lists your subscriptions and the five most expensive resources this month.
3. Open any resource in the Azure portal (for example a storage account). A small "azinfo" pill appears in the bottom-right corner; click it to see this month's cost, the projection, last month, the cost by meter and any Azure Advisor savings tips.
4. Open a resource group to see every resource in it, sorted by cost, with the group total.

Network access: only login.microsoftonline.com (sign-in) and management.azure.com (subscriptions, Cost Management and Advisor read calls). Cost data can lag by several hours.
```

## Distribution tab

| Field | Value |
|---|---|
| Visibility | Public (or Unlisted for a quiet first release) |
| Regions | All regions |
| Payments | Free |

## Account tab (once)

- Contact email: verify it (Google sends a link), or publishing is blocked.
- Trader / non-trader (EU): your own legal declaration; read Google's explanation.
