# azinfo for administrators: approving the app

azinfo is a browser extension that shows Azure cost information next to the resource a user is
viewing in the Azure portal. Users sign in with their own Microsoft Entra account. If your
organisation doesn't let users approve apps themselves, they see **"Approval required"** (or
**"Need admin approval"**) the first time, and an administrator approves azinfo once for the whole
tenant.

You need one of these Entra roles: **Global Administrator**, **Cloud Application Administrator**
or **Application Administrator**.

| | |
|---|---|
| App name | azinfo |
| Application (client) ID | `e76d6bcf-bcea-4d90-a659-2d47135dfa96` |
| Publisher | Mohamed Akour (individual developer) |
| Privacy policy | <https://meedruoka.github.io/azinfo-site/privacy-policy.html> |

## What azinfo asks for

| Permission | API | Type | Why |
|---|---|---|---|
| `user_impersonation` | Azure Service Management | Delegated | List subscriptions and read Cost Management data as the signed-in user |
| `openid`, `profile`, `offline_access` | Microsoft identity platform | Delegated | Sign-in, and staying signed in during the browser session |

What this means in practice:

- **No more access than the user already has.** Delegated permission means azinfo acts as the
  user and sees only what that user's own Azure roles allow (for example Reader or Cost
  Management Reader). Approving azinfo grants no Azure role to anyone.
- **Read-only.** azinfo only reads. The only POST request it makes is the Cost Management
  *query* endpoint, which reads cost data. It never creates, changes or deletes anything in
  Azure.
- **No application permissions and no client secret.** azinfo can't do anything without a signed-in
  user.
- **No server.** Requests go directly from the user's browser to `login.microsoftonline.com` and
  `management.azure.com`. There are no analytics or telemetry. Sign-in tokens are held in browser
  memory only.

## Option 1: approve while signing in

1. Open azinfo in the browser with the extension installed and choose **Sign in**. Or, on the
   *"Need admin approval"* screen a user saw, choose **"Have an admin account? Sign in with that
   account"**.
2. Sign in with your administrator account.
3. Tick **Consent on behalf of your organization** and choose **Accept**.

## Option 2: admin consent link

Open this link in any browser, after replacing `{tenant}` with your tenant ID or primary domain:

```
https://login.microsoftonline.com/{tenant}/v2.0/adminconsent?client_id=e76d6bcf-bcea-4d90-a659-2d47135dfa96&scope=https://management.azure.com/user_impersonation&redirect_uri=https://agbbplllbldedlebmjoplcjilocgphia.chromiumapp.org/
```

Sign in and choose **Accept**. Afterwards, the browser tries to open the extension's sign-in
address. Outside the extension, that address doesn't load. **This is expected: the approval
has already been saved.** To check it, go to **Enterprise applications → azinfo → Permissions**.

## Option 3: let users request approval

1. Go to **Entra admin center → Enterprise applications → Consent and permissions → Admin consent
   settings**.
2. Turn on **Users can request admin consent to apps they are unable to consent to**, and choose
   the reviewers.

Users then see **Request approval** instead of a dead end. Reviewers get an email and approve
under **Enterprise applications → Admin consent requests**.

## Optional: limit who can use azinfo

After approval, go to **Enterprise applications → azinfo → Properties**:

1. Set **Assignment required?** to **Yes**.
2. Add users or groups under **Users and groups**.

Everyone else gets a sign-in error.

## Removing azinfo

To revoke access for everyone:

1. Go to **Enterprise applications → azinfo → Properties**.
2. Choose **Delete**, or set **Enabled for users to sign-in?** to **No**.

Users can also remove the extension from their browser at any time. That discards its stored
cost data.

## Publisher status

The consent screen shows azinfo as **unverified**. That means its publisher, an individual
developer, hasn't completed Microsoft's publisher verification. It says nothing about what the app
can access: that is limited to the permissions above.

Questions: <https://github.com/meedruoka/azinfo-site/issues>.
