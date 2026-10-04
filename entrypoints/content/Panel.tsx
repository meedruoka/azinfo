import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import { describeResourceId } from '@/lib/azure/resource-id';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatPercent, formatTime } from '@/lib/format';
import { sendRequest } from '@/lib/messages';
import { type PanelState, panelStateFromResult } from '@/lib/panel/panel-state';
import type { PortalContext } from '@/lib/portal/parse-portal-url';

/** Per-browser convenience only: whether the panel is shrunk to a pill. */
export const panelCollapsedItem = storage.defineItem<boolean>('local:panel.collapsed', {
  fallback: true,
});

export interface PanelProps {
  context: PortalContext | null;
  /** Injectable for tests; defaults to messaging the background worker. */
  request?: typeof sendRequest;
}

/** Hidden except on resource pages (resource groups arrive in M4). */
export function Panel({ context, request = sendRequest }: PanelProps) {
  if (context?.kind !== 'resource') return null;
  // Keyed by resource: navigating remounts, dropping any in-flight answer.
  return <ResourcePanel key={context.resourceId} context={context} request={request} />;
}

type ResourceContext = Extract<PortalContext, { kind: 'resource' }>;

function ResourcePanel({
  context,
  request,
}: {
  context: ResourceContext;
  request: typeof sendRequest;
}) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [collapsed, setCollapsed] = useState(true);
  const latest = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const id = ++latest.current;
      setState({ kind: 'loading' });
      const res = await request({
        type: 'getResourceCost',
        subscriptionId: context.subscriptionId,
        resourceId: context.resourceId,
        force,
      });
      // Ignore answers overtaken by a newer request or an unmount.
      if (id === latest.current) setState(panelStateFromResult(res));
    },
    [context.subscriptionId, context.resourceId, request],
  );

  useEffect(() => {
    void load();
    return () => {
      latest.current++;
    };
  }, [load]);

  useEffect(() => {
    void panelCollapsedItem.getValue().then(setCollapsed);
    return panelCollapsedItem.watch(setCollapsed);
  }, []);

  // The worker records "rate limited, retrying" while it waits.
  useEffect(
    () =>
      costStatusItem.watch((all) => {
        const status = all[context.subscriptionId];
        setState((s) =>
          s.kind === 'loading' ? { kind: 'loading', rateLimitedUntil: status?.retryAt } : s,
        );
      }),
    [context.subscriptionId],
  );

  const toggle = (next: boolean) => {
    setCollapsed(next);
    void panelCollapsedItem.setValue(next);
  };

  const signIn = async () => {
    setState({ kind: 'loading' });
    const res = await request({ type: 'signIn' });
    if (res.ok) await load();
    else setState(panelStateFromResult(res));
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="azinfo-pill"
        onClick={() => toggle(false)}
        aria-label={`azinfo cost panel: ${pillText(state)}. Expand.`}
      >
        <span className="brand">azinfo</span>
        <span className="pill-value">{pillText(state)}</span>
      </button>
    );
  }

  const { type } = describeResourceId(context.resourceId);
  return (
    <section className="azinfo-card" aria-label="azinfo cost panel">
      <header>
        <div className="title">
          <span className="brand">azinfo</span>
          <span className="resource" title={context.resourceId}>
            {context.name}
          </span>
          <span className="type">{type}</span>
        </div>
        <button type="button" className="icon" onClick={() => toggle(true)} aria-label="Collapse">
          –
        </button>
      </header>
      <Body state={state} onRetry={() => load(true)} onSignIn={signIn} />
    </section>
  );
}

function Body({
  state,
  onRetry,
  onSignIn,
}: {
  state: PanelState;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  switch (state.kind) {
    case 'loading':
      return (
        <p className="muted">
          {state.rateLimitedUntil
            ? `Rate limited by Azure, retrying at ${formatTime(state.rateLimitedUntil)}…`
            : 'Loading cost…'}
        </p>
      );
    case 'notSignedIn':
      return (
        <>
          <p>Sign in to see this resource's cost.</p>
          <button type="button" className="primary" onClick={onSignIn}>
            Sign in
          </button>
        </>
      );
    case 'noCostAccess':
      return (
        <p>
          No access to cost data for this subscription. It needs the Cost Management Reader role.
        </p>
      );
    case 'noData':
      return (
        <>
          <p>No cost recorded for this resource this month or last.</p>
          <p className="muted small">
            Some resources are billed through another one, for example a web app through its App
            Service plan.
          </p>
          <Footer fetchedAt={state.fetchedAt} onRefresh={onRetry} />
        </>
      );
    case 'rateLimited':
      return (
        <>
          <p>
            Azure is rate limiting cost queries
            {state.retryAt ? `. Try again after ${formatTime(state.retryAt)}.` : '.'}
          </p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      );
    case 'error':
      return (
        <>
          <p className="error">{state.message}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </>
      );
    case 'data':
      return (
        <>
          <dl>
            <dt>This month so far</dt>
            <dd className="big">{formatMoney(state.mtd, state.currency)}</dd>
            <dt>Last month</dt>
            <dd>{formatMoney(state.lastMonth, state.currency)}</dd>
            <dt>So far vs. all of last month</dt>
            <dd>{changeText(state)}</dd>
          </dl>
          <Footer fetchedAt={state.fetchedAt} onRefresh={onRetry} />
        </>
      );
  }
}

function Footer({ fetchedAt, onRefresh }: { fetchedAt: number; onRefresh: () => void }) {
  return (
    <p className="muted small footer">
      Updated {formatTime(fetchedAt)}. Azure cost data lags by several hours.{' '}
      <button type="button" className="link" onClick={onRefresh}>
        Refresh
      </button>
    </p>
  );
}

function changeText(state: Extract<PanelState, { kind: 'data' }>): string {
  switch (state.change.kind) {
    case 'percent':
      return formatPercent(state.change.value);
    case 'new':
      return 'New this month';
    case 'none':
      return '–';
  }
}

export function pillText(state: PanelState): string {
  switch (state.kind) {
    case 'loading':
      return state.rateLimitedUntil ? 'rate limited…' : '…';
    case 'data':
      return formatMoney(state.mtd, state.currency);
    case 'notSignedIn':
      return 'sign in';
    case 'noCostAccess':
      return 'no access';
    case 'noData':
      return 'no cost';
    case 'rateLimited':
      return 'rate limited';
    case 'error':
      return 'error';
  }
}
