import { useCallback, useEffect, useState } from 'react';
import type { Subscription } from '@/lib/azure/subscriptions';
import { sendRequest } from '@/lib/messages';
import { TopCosts } from './TopCosts';

type View =
  | { kind: 'loading' }
  | { kind: 'signedOut'; error?: string }
  | { kind: 'signingIn' }
  | { kind: 'signedIn'; subscriptions?: Subscription[]; error?: string };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const loadSubscriptions = useCallback(async () => {
    setView({ kind: 'signedIn' });
    const res = await sendRequest({ type: 'listSubscriptions' });
    if (res.ok) setView({ kind: 'signedIn', subscriptions: res.data });
    else if (res.kind === 'notSignedIn') setView({ kind: 'signedOut' });
    else setView({ kind: 'signedIn', error: res.message });
  }, []);

  useEffect(() => {
    sendRequest({ type: 'getAuthState' }).then((res) => {
      if (!res.ok) setView({ kind: 'signedOut', error: res.message });
      else if (res.data.signedIn) void loadSubscriptions();
      else setView({ kind: 'signedOut' });
    });
  }, [loadSubscriptions]);

  async function signIn() {
    setView({ kind: 'signingIn' });
    // The sign-in window may close this popup; the worker finishes anyway and
    // the next popup open shows the result.
    const res = await sendRequest({ type: 'signIn' });
    if (res.ok) await loadSubscriptions();
    else setView({ kind: 'signedOut', error: res.message });
  }

  async function signOut() {
    await sendRequest({ type: 'signOut' });
    setView({ kind: 'signedOut' });
  }

  return (
    <main>
      <header>
        <h1>azinfo</h1>
        {view.kind === 'signedIn' && (
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>

      {view.kind === 'loading' && <p className="muted">Loading…</p>}

      {view.kind === 'signingIn' && <p className="muted">Signing in…</p>}

      {view.kind === 'signedOut' && (
        <>
          <p>Sign in with the Microsoft account you use for Azure.</p>
          <button type="button" className="primary" onClick={signIn}>
            Sign in
          </button>
          {view.error && <p className="error">{view.error}</p>}
        </>
      )}

      {view.kind === 'signedIn' && (
        <>
          {view.error && <p className="error">{view.error}</p>}
          {!view.error && !view.subscriptions && <p className="muted">Loading…</p>}
          {view.subscriptions?.length === 0 && (
            <p className="muted">No subscriptions visible to this account.</p>
          )}
          {view.subscriptions && view.subscriptions.length > 0 && (
            <SubscriptionCosts subscriptions={view.subscriptions} />
          )}
        </>
      )}
    </main>
  );
}

function SubscriptionCosts({ subscriptions }: { subscriptions: Subscription[] }) {
  const firstEnabled = subscriptions.find((s) => s.state === 'Enabled') ?? subscriptions[0];
  const [selected, setSelected] = useState(firstEnabled?.subscriptionId ?? '');

  return (
    <>
      <label className="field">
        <span>Subscription</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {subscriptions.map((s) => (
            <option key={s.subscriptionId} value={s.subscriptionId}>
              {s.displayName}
              {s.state === 'Enabled' ? '' : ` (${s.state})`}
            </option>
          ))}
        </select>
      </label>
      <h2>Top 5 this month</h2>
      {selected && <TopCosts key={selected} subscriptionId={selected} />}
    </>
  );
}

export default App;
