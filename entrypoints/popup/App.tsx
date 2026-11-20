import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { personalTenant } from '@/lib/auth/sign-in-choice';
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

type SignInChoice = Pick<
  ResponseMap['getAuthState'],
  'chooseAccount' | 'lastPortalTenant' | 'returning' | 'rememberedTenant'
>;

export function App({ request = sendRequest }: AppProps) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [choice, setChoice] = useState<SignInChoice>({
    chooseAccount: true,
    lastPortalTenant: null,
    returning: false,
    rememberedTenant: null,
  });

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

  const readAuthState = useCallback(async () => {
    const res = await request({ type: 'getAuthState' });
    if (!res.ok) return setView({ kind: 'signedOut', error: res.message });
    setChoice({
      chooseAccount: res.data.chooseAccount,
      lastPortalTenant: res.data.lastPortalTenant,
      // Older workers may not send these: treat as a fresh sign-in.
      returning: res.data.returning ?? false,
      rememberedTenant: res.data.rememberedTenant ?? null,
    });
    if (res.data.signedIn) void loadDirectory();
    else setView({ kind: 'signedOut' });
  }, [loadDirectory, request]);

  useEffect(() => {
    void readAuthState();
  }, [readAuthState]);

  /** `personalTenant`: a personal account's own tenant; absent for work accounts. */
  async function signIn(personalTenant?: string) {
    setView({ kind: 'signingIn' });
    // The sign-in window may close this popup; the worker finishes anyway and
    // the next popup open shows the result.
    const res = await request(
      personalTenant === undefined ? { type: 'signIn' } : { type: 'signIn', personalTenant },
    );
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
    await readAuthState();
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
        <SignIn
          key={`${choice.lastPortalTenant ?? ''}|${choice.rememberedTenant ?? ''}|${choice.returning}`}
          {...choice}
          error={view.error}
          onSignIn={signIn}
        />
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

/** A value to type, so not translated (decision 005). */
const TENANT_EXAMPLE = 'yourname.onmicrosoft.com';

/**
 * Sign-in for a fresh install (decision 006): work or school accounts use
 * the build default, personal accounts their own tenant. A tenant set on the
 * options page means a single Sign in button.
 */
function SignIn({
  chooseAccount,
  lastPortalTenant,
  returning,
  rememberedTenant,
  error,
  onSignIn,
}: SignInChoice & { error?: string; onSignIn: (personalTenant?: string) => void }) {
  const [personal, setPersonal] = useState(false);
  const [tenant, setTenant] = useState(lastPortalTenant ?? rememberedTenant ?? '');
  const [invalid, setInvalid] = useState(false);
  // After a browser restart the silent sign-in may fail: one click with the same account.
  const [otherAccount, setOtherAccount] = useState(false);
  const tenantId = useId();

  if (chooseAccount && returning && !otherAccount) {
    return (
      <>
        <p>{t('signInAgainPrompt')}</p>
        <button
          type="button"
          className="primary"
          onClick={() => onSignIn(rememberedTenant ?? undefined)}
        >
          {rememberedTenant ? t('signInAgainTenant', rememberedTenant) : t('signInAgainWork')}
        </button>
        <p>
          <button type="button" className="link" onClick={() => setOtherAccount(true)}>
            {t('signInOtherAccount')}
          </button>
        </p>
        {error && <p className="error">{error}</p>}
      </>
    );
  }

  if (!chooseAccount) {
    return (
      <>
        <p>{t('popupSignInPrompt')}</p>
        <button type="button" className="primary" onClick={() => onSignIn()}>
          {t('signIn')}
        </button>
        {error && <p className="error">{error}</p>}
      </>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = personalTenant(tenant);
    setInvalid(value === null);
    if (value !== null) onSignIn(value);
  }

  return (
    <>
      <p>{t('signInChooseAccount')}</p>
      <div className="choices">
        <button type="button" className="primary" onClick={() => onSignIn()}>
          {t('signInWork')}
        </button>
        <button type="button" aria-expanded={personal} onClick={() => setPersonal(true)}>
          {t('signInPersonal')}
        </button>
      </div>
      {personal && (
        <form className="personal" onSubmit={submit}>
          <label className="field" htmlFor={tenantId}>
            <span>{t('signInTenantLabel')}</span>
          </label>
          <input
            id={tenantId}
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder={TENANT_EXAMPLE}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid}
          />
          <p className="muted small">{t('signInTenantHelp', TENANT_EXAMPLE)}</p>
          {invalid && <p className="error">{t('signInTenantInvalid')}</p>}
          <button type="submit" className="primary">
            {t('signIn')}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </>
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
