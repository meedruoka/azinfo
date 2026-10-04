import { useCallback, useEffect, useState } from 'react';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatTime } from '@/lib/format';
import { type ResponseMap, sendRequest } from '@/lib/messages';

type TopCostsData = ResponseMap['getTopCosts'];

type State =
  | { kind: 'loading'; rateLimitedUntil?: number }
  | { kind: 'ready'; data: TopCostsData }
  | { kind: 'error'; message: string };

const ERROR_TEXT: Partial<Record<string, string>> = {
  noCostAccess: 'No access to cost data for this subscription (needs Cost Management Reader).',
  rateLimited: 'Azure is rate limiting cost queries. Try again in a minute.',
};

export function TopCosts({ subscriptionId }: { subscriptionId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(
    async (force = false) => {
      setState({ kind: 'loading' });
      const res = await sendRequest({ type: 'getTopCosts', subscriptionId, force });
      if (res.ok) setState({ kind: 'ready', data: res.data });
      else setState({ kind: 'error', message: ERROR_TEXT[res.kind] ?? res.message });
    },
    [subscriptionId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The worker records "rate limited, retrying" while it waits.
  useEffect(
    () =>
      costStatusItem.watch((all) => {
        const status = all[subscriptionId.toLowerCase()];
        setState((s) =>
          s.kind === 'loading' ? { kind: 'loading', rateLimitedUntil: status?.retryAt } : s,
        );
      }),
    [subscriptionId],
  );

  if (state.kind === 'loading') {
    return (
      <p className="muted">
        {state.rateLimitedUntil
          ? `Rate limited by Azure, retrying at ${formatTime(state.rateLimitedUntil)}…`
          : 'Loading costs…'}
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <p className="error">{state.message}</p>
        <button type="button" onClick={() => load(true)}>
          Retry
        </button>
      </>
    );
  }

  const { top, fetchedAt } = state.data;
  return (
    <>
      {top.length === 0 ? (
        <p className="muted">No resource costs this month or last month.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th className="num">This month</th>
              <th className="num">Last month</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.resourceId} title={r.resourceId}>
                <td>
                  <div className="name">{r.name}</div>
                  <div className="muted small">{r.type}</div>
                </td>
                <td className="num">{formatMoney(r.mtd, r.currency)}</td>
                <td className="num">{formatMoney(r.lastMonth, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small footer">
        Updated {formatTime(fetchedAt)}. Azure cost data lags by several hours.{' '}
        <button type="button" className="link" onClick={() => load(true)}>
          Refresh
        </button>
      </p>
    </>
  );
}
