import { useCallback, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { T } from '@/lib/i18n-react';
import { type ResponseMap, sendRequest } from '@/lib/messages';
import { TopCosts } from './TopCosts';

type DirectoryData = ResponseMap['getDirectory'];

type View =
  | { kind: 'loading' }
  | { kind: 'signedOut'; error?: string }
  | { kind: 'signingIn' }
  | { kind: 'signedIn'; directory?: DirectoryData; error?: string };

export interface AppProps {
  /** Injectable for tests; defaults to messaging the background worker. */
  request?: typeof sendRequest;
}

export function App({ request = sendRequest }: AppProps) {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const loadDirectory = useCallback(
    async (force = false) => {
      setView({ kind: 'signedIn' });
      const res = await request({ type: 'getDirectory', force });
      if (res.ok) setView({ kind: 'signedIn', directory: res.data });
      else if (res.kind === 'notSignedIn') setView({ kind: 'signedOut' });
      else setView({ kind: 'signedIn', error: res.message });
    },
    [request],
  );

  useEffect(() => {
    request({ type: 'getAuthState' }).then((res) => {
      if (!res.ok) setView({ kind: 'signedOut', error: res.message });
      else if (res.data.signedIn) void loadDirectory();
      else setView({ kind: 'signedOut' });
    });
  }, [loadDirectory, request]);

  async function signIn() {
    setView({ kind: 'signingIn' });
    // The sign-in window may close this popup; the worker finishes anyway and
    // the next popup open shows the result.
    const res = await request({ type: 'signIn' });
    if (res.ok) await loadDirectory();
    else setView({ kind: 'signedOut', error: res.message });
  }

  async function signInTenant(tenantId: string) {
    setView({ kind: 'signingIn' });
    const res = await request({ type: 'signInTenant', tenantId });
    if (res.ok) await loadDirectory();
    else setView({ kind: 'signedIn', error: res.message });
  }

  async function signOut() {
    await request({ type: 'signOut' });
    setView({ kind: 'signedOut' });
  }

  return (
    <main>
      <header>
        <h1>azinfo</h1>
        <div className="actions">
          <button type="button" className="link" onClick={() => browser.runtime.openOptionsPage()}>
            {t('popupOptions')}
          </button>
          {view.kind === 'signedIn' && (
            <button type="button" onClick={signOut}>
              {t('signOut')}
            </button>
          )}
        </div>
      </header>

      {view.kind === 'loading' && <p className="muted">{t('loading')}</p>}

      {view.kind === 'signingIn' && <p className="muted">{t('popupSigningIn')}</p>}

      {view.kind === 'signedOut' && (
        <>
          <p>{t('popupSignInPrompt')}</p>
          <button type="button" className="primary" onClick={signIn}>
            {t('signIn')}
          </button>
          {view.error && <p className="error">{view.error}</p>}
        </>
      )}

      {view.kind === 'signedIn' && (
        <>
          {view.error && (
            <>
              <p className="error">{view.error}</p>
              <button type="button" onClick={() => loadDirectory(true)}>
                {t('retry')}
              </button>
            </>
          )}
          {!view.error && !view.directory && <p className="muted">{t('popupLoadingTenants')}</p>}
          {view.directory && (
            <DirectoryView
              directory={view.directory}
              onSignInTenant={signInTenant}
              onReload={() => loadDirectory(true)}
              request={request}
            />
          )}
        </>
      )}
    </main>
  );
}

function DirectoryView({
  directory,
  onSignInTenant,
  onReload,
  request,
}: {
  directory: DirectoryData;
  onSignInTenant: (tenantId: string) => void;
  onReload: () => void;
  request: typeof sendRequest;
}) {
  const { subscriptions, tenants } = directory;
  const firstEnabled = subscriptions.find((s) => s.state === 'Enabled') ?? subscriptions[0];
  const [selected, setSelected] = useState(firstEnabled?.subscriptionId ?? '');
  const attention = tenants.filter((t) => t.needsSignIn || t.error);
  const multiTenant = tenants.length > 1;

  return (
    <>
      {subscriptions.length === 0 ? (
        <p className="muted">{t('popupNoSubscriptions')}</p>
      ) : (
        <label className="field">
          <span>{t('popupSubscription')}</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {multiTenant
              ? tenants
                  .filter((t) => subscriptions.some((s) => s.accessTenantId === t.tenantId))
                  .map((t) => (
                    <optgroup key={t.tenantId} label={t.displayName}>
                      {subscriptions
                        .filter((s) => s.accessTenantId === t.tenantId)
                        .map((s) => (
                          <SubscriptionOption key={s.subscriptionId} {...s} />
                        ))}
                    </optgroup>
                  ))
              : subscriptions.map((s) => <SubscriptionOption key={s.subscriptionId} {...s} />)}
          </select>
        </label>
      )}

      {attention.length > 0 && (
        <ul className="tenant-notes">
          {attention.map((tenant) => (
            <li key={tenant.tenantId}>
              <span>
                {tenant.needsSignIn ? (
                  <T
                    k="popupTenantNeedsSignIn"
                    slots={[<strong key="name">{tenant.displayName}</strong>]}
                  />
                ) : (
                  <T
                    k="popupTenantFailed"
                    slots={[<strong key="name">{tenant.displayName}</strong>, tenant.error]}
                  />
                )}
              </span>
              {tenant.needsSignIn ? (
                <button type="button" onClick={() => onSignInTenant(tenant.tenantId)}>
                  {t('signIn')}
                </button>
              ) : (
                <button type="button" onClick={onReload}>
                  {t('retry')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <>
          <h2>{t('popupTop5')}</h2>
          <TopCosts key={selected} subscriptionId={selected} request={request} />
        </>
      )}
    </>
  );
}

function SubscriptionOption({
  subscriptionId,
  displayName,
  state,
}: {
  subscriptionId: string;
  displayName: string;
  state: string;
}) {
  return (
    <option value={subscriptionId}>
      {displayName}
      {state === 'Enabled' ? '' : ` (${state})`}
    </option>
  );
}

export default App;
