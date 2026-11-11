# Entra app registration setup

azinfo signs in with its own Entra app registration, never with the Azure
portal's tokens. Create the registration in a tenant **you own personally**,
not an employer's.

## What you need

- A Microsoft account with an Azure subscription, signed in to
  <https://entra.microsoft.com>.
- The extension's redirect URI. For the pinned dev build it is:

  ```
  https://jojhniohldijhpnpeihdnffjflgcpnpb.chromiumapp.org/
  ```

  Chrome Web Store and Edge Add-ons builds get their own IDs, so each needs
  its own redirect URI added later (see [Store builds](#store-builds)).

## Create the registration

1. Open **Entra admin center → Identity → Applications → App registrations →
   New registration**.
2. **Name:** `azinfo (dev)`.
3. **Supported account types:** *Accounts in any organizational directory
   (Any Microsoft Entra ID tenant – Multitenant)*.
4. **Redirect URI:** platform **Single-page application (SPA)**, then paste
   the redirect URI above (see [Platform choice](#platform-choice)).
5. Select **Register**, then copy the **Application (client) ID** from the
   Overview page. It is not a secret.

## API permissions

1. **API permissions → Add a permission → Azure Service Management →
   Delegated permissions → `user_impersonation` → Add permissions**.
2. Remove the default **Microsoft Graph → User.Read**; azinfo does not call
   Graph. The `openid`, `profile` and `offline_access` scopes it requests are
   sign-in scopes and need no entry here.

`user_impersonation` is the only delegated permission Azure Resource Manager
offers, so it cannot be narrowed further. azinfo only issues read requests,
and what you can see is limited by your Azure role (Reader or Cost Management
Reader is enough).

Do **not** create a client secret or certificate. The extension is a public
client and must not hold secrets.

## Platform choice

Use **Single-page application**. Under *Mobile and desktop applications*,
Entra rejects the extension's token requests (AADSTS9002326), because the
service worker always sends an `Origin` header. Details are in
[decision 001](decisions/001-auth.md).

With SPA, sign-in lasts 24 hours. After that the extension signs in again
silently while your Microsoft session in the browser is still active.

## Configure the extension

1. Copy `.env.example` to `.env.local`.
2. Set `WXT_ENTRA_CLIENT_ID` to the client ID.
3. Optionally set `WXT_ENTRA_AUTHORITY`. It's only the **default** tenant for
   a fresh install; users change it on the options page (see below).
4. Run `pnpm build:local` and reload the extension on `chrome://extensions`.

## Which tenant to sign in to

On the **options page** (popup → Options), set *Microsoft Entra tenant*:

- `organizations` for work or school accounts (the default).
- Your tenant's domain or ID (for example `yourname.onmicrosoft.com`) for a
  **personal Microsoft account** (Outlook, Gmail address and so on). Personal
  accounts can't use the `organizations` endpoint. The domain is shown under
  your name in the Azure portal's account menu.

Changing the tenant signs you out, because tokens belong to one tenant.

## Admin consent for organisations

Users approve azinfo's permission the first time they sign in. Many
organisations block that for apps from unverified publishers. Users then see
*"Need admin approval"*, and a tenant administrator grants consent once for
everyone. [admin-consent.md](admin-consent.md) is the page to give
administrators: what azinfo asks for, three ways to approve it, how to limit
or remove it. See also the publisher verification note in
[store-listing.md](store-listing.md).

## Production and store builds

Store builds use a **separate production registration** (`azinfo`), set up
the same way. That way the dev registration can change without affecting
users. Put its client ID in `.env.production.local`, together with
`WXT_ENTRA_AUTHORITY=organizations` (see the release checklist in
[store-listing.md](store-listing.md)).

When the extension is first uploaded, each store assigns an ID. Add each
store's redirect URI (`https://<store-id>.chromiumapp.org/`) to the production
registration, under the SPA platform. The code reads the redirect URI from
`chrome.identity.getRedirectURL()` at runtime, so nothing is hard-coded.
