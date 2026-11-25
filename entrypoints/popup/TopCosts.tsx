import { useCallback, useEffect, useState } from 'react';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatTime } from '@/lib/format';
import { type MessageKey, t } from '@/lib/i18n';
import { type ResponseMap, sendRequest } from '@/lib/messages';

type TopCostsData = ResponseMap['getTopCosts'];

type State =
  | { kind: 'loading'; rateLimitedUntil?: number }
  | { kind: 'ready'; data: TopCostsData }
  | { kind: 'error'; message: string };

const ERROR_TEXT: Partial<Record<string, MessageKey>> = {
  noCostAccess: 'popupNoCostAccess',
  rateLimited: 'popupRateLimited',
};

export function TopCosts({
  subscriptionId,
  request = sendRequest,
}: {
  subscriptionId: string;
  /** Injectable for tests; defaults to messaging the background worker. */
  request?: typeof sendRequest;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(
    async (force = false) => {
      setState({ kind: 'loading' });
      const res = await request({ type: 'getTopCosts', subscriptionId, force });
      if (res.ok) setState({ kind: 'ready', data: res.data });
      else {
        const key = ERROR_TEXT[res.kind];
        setState({ kind: 'error', message: key ? t(key) : res.message });
      }
    },
    [subscriptionId, request],
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
          ? t('rateLimitedRetrying', formatTime(state.rateLimitedUntil))
          : t('popupLoadingCosts')}
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <p className="error">{state.message}</p>
        <button type="button" onClick={() => load(true)}>
          {t('retry')}
        </button>
      </>
    );
  }

  const { top, fetchedAt, costType } = state.data;
  return (
    <>
      {top.length === 0 ? (
        <p className="muted">{t('popupNoCosts')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('resource')}</th>
              <th className="num">{t('thisMonth')}</th>
              <th className="num">{t('lastMonth')}</th>
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
        {costType === 'AmortizedCost' ? t('costTypeAmortized') : t('costTypeActual')} ·{' '}
        {t('updatedAt', formatTime(fetchedAt))}{' '}
        <button type="button" className="link" onClick={() => load(true)}>
          {t('refresh')}
        </button>
      </p>
    </>
  );
}
