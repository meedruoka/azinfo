# azinfo privacy policy

_Last updated: 21 November 2026_

azinfo is a browser extension that shows Microsoft Azure cost information next to the resource you
are viewing in the Azure portal. It's an independent tool and isn't affiliated with or endorsed by
Microsoft.

**In short:** azinfo has no server. Your data is read from Microsoft and stays in your browser.
Nothing is sent to the developer or to any third party.

## What azinfo accesses

| Data | From | Why |
|---|---|---|
| Your Microsoft sign-in (access and refresh tokens) | Microsoft Entra ID (`login.microsoftonline.com`), after you click **Sign in** | To call Azure's cost API as you |
| The Microsoft Entra tenants (directories) you belong to: name, ID and domains | Azure Resource Manager (`management.azure.com`) | So one sign-in works across all your tenants |
| The list of Azure subscriptions you can see | Azure Resource Manager (`management.azure.com`) | So you can choose a subscription |
| Cost figures per resource: this month and last month, with currency, and this month split by meter category | Azure Cost Management (`management.azure.com`) | To show costs next to resources, and what they are made of |
| Azure Advisor's cost recommendations for your resources, with estimated savings | Azure Advisor (`management.azure.com`) | To show savings tips next to resources |
| The address of the Azure portal page you are on | Your browser tab on `portal.azure.com` | To know which resource or resource group you are viewing |

azinfo sees only what your Azure permissions already allow you to see. It doesn't read the
portal's page content, cookies or tokens, and it never changes anything in Azure: it only calls
read operations.

## Where it is stored

| Data | Stored in | Kept until |
|---|---|---|
| Sign-in tokens, and the last tenant seen in a portal address (offered when a personal account signs in) | Browser **session** storage (memory only, never written to disk) | You sign out or close the browser |
| Cached cost figures, Advisor savings tips, and your tenants and subscriptions (names and IDs) | Browser **local** storage on your device | Replaced after the cache period (default 4 hours), or deleted when you sign out or click **Clear cached data** |
| Settings (tenant, cache period, spike threshold, panel collapsed or expanded) | Browser local storage | You change them or remove the extension |
| Whether you are signed in (yes or no), the tenant a personal Microsoft account signed in through, and when a cost request that Azure slowed down will be retried | Browser local storage | You sign out, or the retry happens |
| Which Microsoft account signed in: Microsoft's sign-in hint for it, or your sign-in name (for example your e-mail address). Sent only to Microsoft, so it can sign you in again without asking which account when your browser has several | Browser local storage | You sign out |

Removing the extension deletes all of the above.

## What never leaves your browser

- azinfo has **no backend server**. It sends no analytics, telemetry, crash reports or advertising
  data.
- The only network requests go to Microsoft: `login.microsoftonline.com` (sign-in) and
  `management.azure.com` (subscriptions and cost data).
- Your data isn't sold, shared, or used for anything other than showing costs to you.

## Your choices

- **Sign out** from the toolbar popup. This removes your tokens and cached cost data.
- **Clear cached data** on the options page at any time.
- To revoke azinfo's access to your Microsoft account, go to
  <https://myapps.microsoft.com> (work or school accounts) or
  <https://account.live.com/consent/Manage> (personal accounts).

## Changes

Any change to this policy will be published here with a new date.

## Contact

Mohamed Akour. Questions or requests: open an issue at
<https://github.com/AkourMohamed/azinfo-site/issues>.
