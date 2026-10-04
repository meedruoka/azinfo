import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import { describeResourceId } from '@/lib/azure/resource-id';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatPercent, formatTime } from '@/lib/format';
import type { AssessedCost, Result, SpikeContext } from '@/lib/messages';
import { sendRequest } from '@/lib/messages';
import {
  errorState,
  groupPanelStateFromResult,
  type PanelState,
  panelStateFromResult,
} from '@/lib/panel/panel-state';
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

type ResourceContext = Extract<PortalContext, { kind: 'resource' }>;
type GroupContext = Extract<PortalContext, { kind: 'resourceGroup' }>;

/** Shown on resource and resource-group pages; hidden everywhere else. */
export function Panel({ context, request = sendRequest }: PanelProps) {
  // Keyed by ID: navigating remounts, dropping any in-flight answer.
  if (context?.kind === 'resource') {
    return <ResourcePanel key={context.resourceId} context={context} request={request} />;
  }
  if (context?.kind === 'resourceGroup') {
    return <GroupPanel key={context.resourceId} context={context} request={request} />;
  }
  return null;
}

function ResourcePanel({
  context,
  request,
}: {
  context: ResourceContext;
  request: typeof sendRequest;
}) {
  const fetchState = useCallback(
    async (force: boolean) =>
      panelStateFromResult(
        await request({
          type: 'getResourceCost',
          subscriptionId: context.subscriptionId,
          resourceId: context.resourceId,
          force,
        }),
      ),
    [context.subscriptionId, context.resourceId, request],
  );
  const { type } = describeResourceId(context.resourceId);
  return (
    <CostPanel
      subscriptionId={context.subscriptionId}
      title={context.name}
      subtitle={type}
      titleTooltip={context.resourceId}
      fetchState={fetchState}
      request={request}
    />
  );
}

function GroupPanel({ context, request }: { context: GroupContext; request: typeof sendRequest }) {
  const fetchState = useCallback(
    async (force: boolean) =>
      groupPanelStateFromResult(
        await request({
          type: 'getResourceGroupCosts',
          subscriptionId: context.subscriptionId,
          resourceGroupId: context.resourceId,
          force,
        }),
      ),
    [context.subscriptionId, context.resourceId, request],
  );
  return (
    <CostPanel
      subscriptionId={context.subscriptionId}
      title={context.resourceGroup}
      subtitle="Resource group"
      titleTooltip={context.resourceId}
      fetchState={fetchState}
      request={request}
    />
  );
}

/** Loading, stale-answer protection, rate-limit status, collapse and sign-in. */
function CostPanel({
  subscriptionId,
  title,
  subtitle,
  titleTooltip,
  fetchState,
  request,
}: {
  subscriptionId: string;
  title: string;
  subtitle: string;
  titleTooltip: string;
  fetchState: (force: boolean) => Promise<PanelState>;
  request: typeof sendRequest;
}) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [collapsed, setCollapsed] = useState(true);
  const latest = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const id = ++latest.current;
      setState({ kind: 'loading' });
      const next = await fetchState(force);
      // Ignore answers overtaken by a newer request or an unmount.
      if (id === latest.current) setState(next);
    },
    [fetchState],
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
        const status = all[subscriptionId];
        setState((s) =>
          s.kind === 'loading' ? { kind: 'loading', rateLimitedUntil: status?.retryAt } : s,
        );
      }),
    [subscriptionId],
  );

  const toggle = (next: boolean) => {
    setCollapsed(next);
    void panelCollapsedItem.setValue(next);
  };

  const signIn = async () => {
    setState({ kind: 'loading' });
    const res: Result<unknown> = await request({ type: 'signIn' });
    if (res.ok) await load();
    else setState(errorState(res));
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

  return (
    <section className="azinfo-card" aria-label="azinfo cost panel">
      <header>
        <div className="title">
          <span className="brand">azinfo</span>
          <span className="resource" title={titleTooltip}>
            {title}
          </span>
          <span className="type">{subtitle}</span>
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
          <p>Sign in to see costs.</p>
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
          {state.spike && <SpikeNote context={state.spikeContext} />}
          <dl>
            <dt>This month so far</dt>
            <dd className="big">{formatMoney(state.mtd, state.currency)}</dd>
            <dt>Projected month-end</dt>
            <dd className={state.spike ? 'spike' : undefined}>
              {projectionText(state.projected, state.currency, state.spikeContext)}
            </dd>
            <dt>Last month</dt>
            <dd>{formatMoney(state.lastMonth, state.currency)}</dd>
            <dt>So far vs. all of last month</dt>
            <dd>{changeText(state.change)}</dd>
          </dl>
          <Footer fetchedAt={state.fetchedAt} onRefresh={onRetry} />
        </>
      );
    case 'group':
      return <GroupBody state={state} onRefresh={onRetry} />;
  }
}

function GroupBody({
  state,
  onRefresh,
}: {
  state: Extract<PanelState, { kind: 'group' }>;
  onRefresh: () => void;
}) {
  if (state.resources.length === 0) {
    return (
      <>
        <p>No resources in this group have cost this month or last.</p>
        <Footer fetchedAt={state.fetchedAt} onRefresh={onRefresh} />
      </>
    );
  }
  return (
    <>
      {state.spikes > 0 && <SpikeNote context={state.spikeContext} count={state.spikes} />}
      {state.total && (
        <dl>
          <dt>Group this month so far</dt>
          <dd className="big">{formatMoney(state.total.mtd, state.total.currency)}</dd>
          <dt>Group last month</dt>
          <dd>{formatMoney(state.total.lastMonth, state.total.currency)}</dd>
        </dl>
      )}
      <p className="muted small list-label">Resources with cost this month or last</p>
      <ResourceTable resources={state.resources} />
      <Footer fetchedAt={state.fetchedAt} onRefresh={onRefresh} />
    </>
  );
}

function ResourceTable({ resources }: { resources: AssessedCost[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th className="num">This month</th>
            <th className="num">Last month</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.resourceId} title={r.resourceId}>
              <td>
                <div className="row-name">
                  {r.assessment.spike && (
                    <span
                      className="spike-badge"
                      title="Projected spike"
                      role="img"
                      aria-label="Spike"
                    >
                      ▲
                    </span>
                  )}
                  {r.name}
                </div>
                <div className="type">{r.type}</div>
              </td>
              <td className="num">{formatMoney(r.mtd, r.currency)}</td>
              <td className="num">{formatMoney(r.lastMonth, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpikeNote({ context, count }: { context: SpikeContext; count?: number }): ReactNode {
  const what =
    count === undefined
      ? 'Projected month-end is'
      : `${count} resource${count === 1 ? '' : 's'} projected`;
  return (
    <p className="spike-note">
      ▲ {what} more than {context.thresholdPct}% above last month.
    </p>
  );
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

function projectionText(projected: number | null, currency: string, context: SpikeContext) {
  if (projected === null) return 'From tomorrow';
  const amount = formatMoney(projected, currency);
  return context.daysElapsed < 5 ? `${amount} (early estimate)` : amount;
}

function changeText(change: Extract<PanelState, { kind: 'data' }>['change']): string {
  switch (change.kind) {
    case 'percent':
      return formatPercent(change.value);
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
      return `${formatMoney(state.mtd, state.currency)}${state.spike ? ' · spike' : ''}`;
    case 'group': {
      const total = state.total ? formatMoney(state.total.mtd, state.total.currency) : 'mixed';
      const spikes = state.spikes ? ` · ${state.spikes} spike${state.spikes === 1 ? '' : 's'}` : '';
      return state.resources.length ? `${total}${spikes}` : 'no cost';
    }
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
