import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import type { Savings, Tip } from '@/lib/azure/advisor';
import { describeResourceId } from '@/lib/azure/resource-id';
import { type MeterShare, OTHER_METERS } from '@/lib/cost/breakdown';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatPercent, formatShare, formatTime } from '@/lib/format';
import { t, tp } from '@/lib/i18n';
import type { AssessedCost, Result, SpikeContext, TipsResult } from '@/lib/messages';
import { sendRequest } from '@/lib/messages';
import {
  errorState,
  groupPanelStateFromResult,
  type PanelState,
  panelStateFromResult,
  tipCount,
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
          tenantHint: context.tenant,
          force,
        }),
      ),
    [context.subscriptionId, context.resourceId, context.tenant, request],
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
      tenantLabel={context.tenant}
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
          tenantHint: context.tenant,
          force,
        }),
      ),
    [context.subscriptionId, context.resourceId, context.tenant, request],
  );
  return (
    <CostPanel
      subscriptionId={context.subscriptionId}
      title={context.resourceGroup}
      subtitle={t('panelResourceGroup')}
      titleTooltip={context.resourceId}
      fetchState={fetchState}
      request={request}
      tenantLabel={context.tenant}
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
  tenantLabel,
}: {
  subscriptionId: string;
  title: string;
  subtitle: string;
  titleTooltip: string;
  fetchState: (force: boolean) => Promise<PanelState>;
  request: typeof sendRequest;
  /** Tenant from the portal URL, to name it in "sign in to …". */
  tenantLabel?: string;
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

  const signIn = async (tenantId?: string) => {
    setState({ kind: 'loading' });
    const res: Result<unknown> = await request(
      tenantId ? { type: 'signInTenant', tenantId } : { type: 'signIn' },
    );
    if (res.ok) await load();
    else setState(errorState(res));
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="azinfo-pill"
        onClick={() => toggle(false)}
        aria-label={t('panelPillLabel', pillText(state))}
      >
        <span className="brand">azinfo</span>
        <span className="pill-value">{pillText(state)}</span>
      </button>
    );
  }

  return (
    <section className="azinfo-card" aria-label={t('panelLabel')}>
      <header>
        <div className="title">
          <span className="brand">azinfo</span>
          <span className="resource" title={titleTooltip}>
            {title}
          </span>
          <span className="type">{subtitle}</span>
        </div>
        <button
          type="button"
          className="icon"
          onClick={() => toggle(true)}
          aria-label={t('panelCollapse')}
        >
          –
        </button>
      </header>
      <Body state={state} onRetry={() => load(true)} onSignIn={signIn} tenantLabel={tenantLabel} />
    </section>
  );
}

function Body({
  state,
  onRetry,
  onSignIn,
  tenantLabel,
}: {
  state: PanelState;
  onRetry: () => void;
  onSignIn: (tenantId?: string) => void;
  tenantLabel?: string;
}) {
  switch (state.kind) {
    case 'loading':
      return (
        <p className="muted">
          {state.rateLimitedUntil
            ? t('rateLimitedRetrying', formatTime(state.rateLimitedUntil))
            : t('panelLoadingCost')}
        </p>
      );
    case 'notSignedIn':
      return (
        <>
          <p>{t('panelSignInToSee')}</p>
          <button type="button" className="primary" onClick={() => onSignIn()}>
            {t('signIn')}
          </button>
        </>
      );
    case 'tenantSignIn':
      return (
        <>
          <p>{tenantLabel ? t('panelOtherTenantNamed', tenantLabel) : t('panelOtherTenant')}</p>
          <button type="button" className="primary" onClick={() => onSignIn(state.tenantId)}>
            {t('panelSignInToTenant')}
          </button>
        </>
      );
    case 'noCostAccess':
      return <p>{t('panelNoCostAccess')}</p>;
    case 'noData':
      return (
        <>
          <p>{t('panelNoData')}</p>
          <p className="muted small">{t('panelNoDataHint')}</p>
          <Footer fetchedAt={state.fetchedAt} onRefresh={onRetry} />
        </>
      );
    case 'rateLimited':
      return (
        <>
          <p>
            {state.retryAt
              ? t('panelRateLimitedUntil', formatTime(state.retryAt))
              : t('panelRateLimited')}
          </p>
          <button type="button" onClick={onRetry}>
            {t('retry')}
          </button>
        </>
      );
    case 'error':
      return (
        <>
          <p className="error">{state.message}</p>
          <button type="button" onClick={onRetry}>
            {t('retry')}
          </button>
        </>
      );
    case 'data':
      return (
        <>
          {state.spike && <SpikeNote context={state.spikeContext} />}
          <dl>
            <dt>{t('panelThisMonthSoFar')}</dt>
            <dd className="big">{formatMoney(state.mtd, state.currency)}</dd>
            <dt>{t('panelProjected')}</dt>
            <dd className={state.spike ? 'spike' : undefined}>
              {projectionText(state.projected, state.currency, state.spikeContext)}
            </dd>
            <dt>{t('lastMonth')}</dt>
            <dd>{formatMoney(state.lastMonth, state.currency)}</dd>
            <dt>{t('panelVsLastMonth')}</dt>
            <dd>{changeText(state.change)}</dd>
          </dl>
          <Breakdown rows={state.breakdown} currency={state.currency} />
          <Tips tips={state.tips} />
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
        <p>{t('panelGroupNoCost')}</p>
        {state.tips.ok && state.tips.items.length > 0 && <Tips tips={state.tips} showResource />}
        <Footer fetchedAt={state.fetchedAt} onRefresh={onRefresh} />
      </>
    );
  }
  return (
    <>
      {state.spikes > 0 && <SpikeNote context={state.spikeContext} count={state.spikes} />}
      {state.total && (
        <dl>
          <dt>{t('panelGroupThisMonth')}</dt>
          <dd className="big">{formatMoney(state.total.mtd, state.total.currency)}</dd>
          <dt>{t('panelGroupLastMonth')}</dt>
          <dd>{formatMoney(state.total.lastMonth, state.total.currency)}</dd>
        </dl>
      )}
      <Breakdown rows={state.breakdown} currency={state.total?.currency} />
      <p className="muted small list-label">{t('panelGroupListLabel')}</p>
      <ResourceTable resources={state.resources} />
      <Tips tips={state.tips} showResource />
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
            <th>{t('resource')}</th>
            <th className="num">{t('thisMonth')}</th>
            <th className="num">{t('lastMonth')}</th>
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
                      title={t('panelSpikeTitle')}
                      role="img"
                      aria-label={t('panelSpikeLabel')}
                    >
                      ▲
                    </span>
                  )}
                  {r.name}
                  {!!r.tipCount && (
                    <span className="tip-badge" title={t('panelTipBadgeTitle')}>
                      {t('panelTipBadge')}
                    </span>
                  )}
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

/** This month's cost by meter category, largest first. */
function Breakdown({ rows, currency }: { rows: MeterShare[]; currency?: string }) {
  // Without one currency (mixed group), amounts can't be shown or compared.
  if (rows.length < 2 || !currency) return null;
  return (
    <>
      <p className="section-label">{t('panelByMeter')}</p>
      <ul className="meters">
        {rows.map((r) => {
          // Our own catch-all is translated; Azure's category names are not.
          const label = r.category === OTHER_METERS ? t('panelMeterOther') : r.category;
          return (
            <li key={r.category}>
              <span className="meter-name" title={label}>
                {label}
              </span>
              <span className="meter-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(r.share * 100)}%` }} />
              </span>
              <span className="meter-value">
                {formatMoney(r.amount, currency)} · {formatShare(r.share)}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Azure Advisor cost recommendations. */
function Tips({ tips, showResource = false }: { tips: TipsResult; showResource?: boolean }) {
  if (!tips.ok) {
    return (
      <p className="muted small section-label">
        {tips.reason === 'noAccess' ? t('panelTipsNoAccess') : t('panelTipsUnavailable')}
      </p>
    );
  }
  if (tips.items.length === 0) {
    return <p className="muted small section-label">{t('panelTipsNone')}</p>;
  }
  return (
    <>
      <p className="section-label">
        {t('panelTipsHeading')}
        {tips.total && tips.items.length > 1 && <> · {savingsText(tips.total)}</>}
      </p>
      <ul className="tips">
        {tips.items.map((tip) => (
          <TipItem key={`${tip.resourceId}|${tip.id}`} tip={tip} showResource={showResource} />
        ))}
      </ul>
    </>
  );
}

const IMPACT_KEYS = { high: 'impactHigh', medium: 'impactMedium', low: 'impactLow' } as const;

function TipItem({ tip, showResource }: { tip: Tip; showResource: boolean }) {
  const impact = tip.impact.toLowerCase();
  const impactKey = IMPACT_KEYS[impact as keyof typeof IMPACT_KEYS];
  return (
    <li>
      {showResource && (
        <div className="type" title={tip.resourceId}>
          {describeResourceId(tip.resourceId).name}
        </div>
      )}
      <div>
        {tip.impact && (
          <span className={`tip-impact ${impact}`}>{impactKey ? t(impactKey) : tip.impact}</span>
        )}
        {tip.problem}
      </div>
      {tip.solution && <div className="muted small">{tip.solution}</div>}
      {tip.savings && <div className="tip-savings small">{savingsText(tip.savings)}</div>}
    </li>
  );
}

function savingsText(savings: Savings): string {
  const amount = formatMoney(savings.amount, savings.currency);
  return savings.period === 'year'
    ? t('panelSaveYear', amount)
    : t('panelSavingsEstimated', amount);
}

function SpikeNote({ context, count }: { context: SpikeContext; count?: number }): ReactNode {
  return (
    <p className="spike-note">
      {count === undefined
        ? t('panelSpikeNote', context.thresholdPct)
        : tp('panelSpikeNoteGroup', count, context.thresholdPct)}
    </p>
  );
}

function Footer({ fetchedAt, onRefresh }: { fetchedAt: number; onRefresh: () => void }) {
  return (
    <p className="muted small footer">
      {t('updatedAt', formatTime(fetchedAt))}{' '}
      <button type="button" className="link" onClick={onRefresh}>
        {t('refresh')}
      </button>
    </p>
  );
}

function projectionText(projected: number | null, currency: string, context: SpikeContext) {
  if (projected === null) return t('panelFromTomorrow');
  const amount = formatMoney(projected, currency);
  return context.daysElapsed < 5 ? t('panelEarlyEstimate', amount) : amount;
}

function changeText(change: Extract<PanelState, { kind: 'data' }>['change']): string {
  switch (change.kind) {
    case 'percent':
      return formatPercent(change.value);
    case 'new':
      return t('panelNewThisMonth');
    case 'none':
      return '–';
  }
}

export function pillText(state: PanelState): string {
  switch (state.kind) {
    case 'loading':
      return state.rateLimitedUntil ? t('pillRateLimitedWaiting') : '…';
    case 'data': {
      const spike = state.spike ? ` · ${t('pillSpike')}` : '';
      return `${formatMoney(state.mtd, state.currency)}${spike}${tipsSuffix(state)}`;
    }
    case 'group': {
      if (!state.resources.length) return t('pillNoCost');
      const total = state.total
        ? formatMoney(state.total.mtd, state.total.currency)
        : t('pillMixed');
      const spikes = state.spikes ? ` · ${tp('pillSpikes', state.spikes)}` : '';
      return `${total}${spikes}${tipsSuffix(state)}`;
    }
    case 'notSignedIn':
    case 'tenantSignIn':
      return t('pillSignIn');
    case 'noCostAccess':
      return t('pillNoAccess');
    case 'noData':
      return t('pillNoCost');
    case 'rateLimited':
      return t('pillRateLimited');
    case 'error':
      return t('pillError');
  }
}

function tipsSuffix(state: PanelState): string {
  const n = tipCount(state);
  return n ? ` · ${tp('pillTips', n)}` : '';
}
