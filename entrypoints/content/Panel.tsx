import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import type { Savings, Tip } from '@/lib/azure/advisor';
import type { MonthlyBudget } from '@/lib/azure/budgets';
import { describeResourceId } from '@/lib/azure/resource-id';
import { type MeterShare, OTHER_METERS } from '@/lib/cost/breakdown';
import { costStatusItem } from '@/lib/cost/cost-service';
import { formatMoney, formatPercent, formatShare, formatTime } from '@/lib/format';
import { t, tp } from '@/lib/i18n';
import type {
  AssessedCost,
  Request,
  ResponseMap,
  Result,
  SpikeContext,
  TipsResult,
} from '@/lib/messages';
import { sendRequest } from '@/lib/messages';
import {
  changeFrom,
  errorState,
  groupPanelStateFromResult,
  type PanelState,
  panelStateFromResult,
  replacesOldFigures,
  tipCount,
} from '@/lib/panel/panel-state';
import type { PortalContext } from '@/lib/portal/parse-portal-url';
import type { CostType } from '@/lib/settings';

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
type TrendRequest = Extract<Request, { type: 'getTrend' }>;
type FetchOptions = { force: boolean; staleOk: boolean };

/** The daily trend, asked for once the main figures are on screen (decision 008). */
type TrendState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ResponseMap['getTrend'] }
  | { kind: 'failed' };

const PRIVACY_URL = 'https://meedruoka.github.io/azinfo/privacy-policy.html';

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
    async ({ force, staleOk }: FetchOptions) =>
      panelStateFromResult(
        await request({
          type: 'getResourceCost',
          subscriptionId: context.subscriptionId,
          resourceId: context.resourceId,
          tenantHint: context.tenant,
          force,
          staleOk,
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
      trendTarget={{ kind: 'resource', resourceId: context.resourceId }}
      request={request}
      tenantLabel={context.tenant}
    />
  );
}

function GroupPanel({ context, request }: { context: GroupContext; request: typeof sendRequest }) {
  const fetchState = useCallback(
    async ({ force, staleOk }: FetchOptions) =>
      groupPanelStateFromResult(
        await request({
          type: 'getResourceGroupCosts',
          subscriptionId: context.subscriptionId,
          resourceGroupId: context.resourceId,
          tenantHint: context.tenant,
          force,
          staleOk,
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
      trendTarget={{ kind: 'resourceGroup', resourceGroupId: context.resourceId }}
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
  trendTarget,
  request,
  tenantLabel,
}: {
  subscriptionId: string;
  title: string;
  subtitle: string;
  titleTooltip: string;
  fetchState: (opts: FetchOptions) => Promise<PanelState>;
  trendTarget: TrendRequest['target'];
  request: typeof sendRequest;
  /** Tenant from the portal URL, to name it in "sign in to …". */
  tenantLabel?: string;
}) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [trend, setTrend] = useState<TrendState>({ kind: 'loading' });
  const [collapsed, setCollapsed] = useState(true);
  const latest = useRef(0);
  // An object prop: compared by value so a re-render doesn't reload.
  const trendKind = trendTarget.kind;
  const trendId =
    trendTarget.kind === 'resource' ? trendTarget.resourceId : trendTarget.resourceGroupId;

  const loadTrend = useCallback(
    async (id: number, force: boolean) => {
      setTrend({ kind: 'loading' });
      const target: TrendRequest['target'] =
        trendKind === 'resource'
          ? { kind: 'resource', resourceId: trendId }
          : { kind: 'resourceGroup', resourceGroupId: trendId };
      const res = await request({
        type: 'getTrend',
        subscriptionId,
        target,
        tenantHint: tenantLabel,
        force,
      });
      if (id !== latest.current) return;
      // No reply at all (the worker restarted) is a failed trend, not a crash.
      setTrend(res?.ok ? { kind: 'ready', data: res.data } : { kind: 'failed' });
    },
    [request, subscriptionId, tenantLabel, trendKind, trendId],
  );

  /**
   * Old figures first when the cache has them, then the refresh (decision
   * 008); the daily trend after that, so it never delays the main figures.
   */
  const load = useCallback(
    async (force = false) => {
      const id = ++latest.current;
      setState({ kind: 'loading' });
      const first = await fetchState({ force, staleOk: !force });
      // Ignore answers overtaken by a newer request or an unmount.
      if (id !== latest.current) return;
      setState(first);
      let final = first;
      if ((first.kind === 'data' || first.kind === 'group') && first.refreshing) {
        const next = await fetchState({ force: false, staleOk: false });
        if (id !== latest.current) return;
        if (next.kind === 'rateLimited' || next.kind === 'error') {
          setState({ ...first, refreshing: false, refreshFailed: true });
        } else {
          setState(next);
          final = next;
        }
        if (replacesOldFigures(next)) return;
      }
      if (final.kind === 'data' || final.kind === 'group') void loadTrend(id, force);
    },
    [fetchState, loadTrend],
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
        setState((s) => (s.kind === 'loading' ? { ...s, rateLimitedUntil: status?.retryAt } : s));
      }),
    [subscriptionId],
  );

  const toggle = (next: boolean) => {
    setCollapsed(next);
    void panelCollapsedItem.setValue(next);
  };

  const runSignIn = async (req: Request) => {
    // The Microsoft window may open behind the browser: say where to look.
    setState({ kind: 'loading', signingIn: true });
    const res: Result<unknown> = await request(req);
    if (res.ok) await load();
    else setState(errorState(res));
  };
  const signIn = (tenantId?: string) =>
    runSignIn(tenantId ? { type: 'signInTenant', tenantId } : { type: 'signIn' });
  // A personal account signs in through the tenant in the page address (decision 006).
  const signInPersonal = tenantLabel
    ? () => runSignIn({ type: 'signIn', personalTenant: tenantLabel })
    : undefined;

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
      <Body
        state={state}
        trend={trend}
        onRetry={() => load(true)}
        onSignIn={signIn}
        onSignInPersonal={signInPersonal}
        tenantLabel={tenantLabel}
      />
    </section>
  );
}

function Body({
  state,
  trend,
  onRetry,
  onSignIn,
  onSignInPersonal,
  tenantLabel,
}: {
  state: PanelState;
  trend: TrendState;
  onRetry: () => void;
  onSignIn: (tenantId?: string) => void;
  /** Absent when the page address names no tenant. */
  onSignInPersonal?: () => void;
  tenantLabel?: string;
}) {
  switch (state.kind) {
    case 'loading':
      return (
        <p className="muted">
          {state.signingIn
            ? t('panelSigningIn')
            : state.rateLimitedUntil
              ? t('rateLimitedRetrying', formatTime(state.rateLimitedUntil))
              : t('panelLoadingCost')}
        </p>
      );
    case 'notSignedIn':
      return (
        <>
          <p>{t('panelSignInToSee')}</p>
          <div className="choices">
            <button type="button" className="primary" onClick={() => onSignIn()}>
              {t('signInWork')}
            </button>
            {onSignInPersonal && (
              <button type="button" onClick={onSignInPersonal}>
                {t('signInPersonal')}
              </button>
            )}
          </div>
          {!onSignInPersonal && <p className="muted small">{t('panelPersonalUsePopup')}</p>}
          <TrustNote />
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
            <Comparison
              trend={trend}
              currency={state.currency}
              fallback={changeText(state.change)}
            />
          </dl>
          <TrendChart trend={trend} currency={state.currency} />
          <Breakdown rows={state.breakdown} currency={state.currency} />
          <Tips tips={state.tips} />
          <Footer {...state} onRefresh={onRetry} />
        </>
      );
    case 'group':
      return <GroupBody state={state} trend={trend} onRefresh={onRetry} />;
  }
}

function GroupBody({
  state,
  trend,
  onRefresh,
}: {
  state: Extract<PanelState, { kind: 'group' }>;
  trend: TrendState;
  onRefresh: () => void;
}) {
  if (state.resources.length === 0) {
    return (
      <>
        <p>{t('panelGroupNoCost')}</p>
        {state.tips.ok && state.tips.items.length > 0 && <Tips tips={state.tips} showResource />}
        <Footer {...state} onRefresh={onRefresh} />
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
          <Comparison trend={trend} currency={state.total.currency} />
        </dl>
      )}
      {state.total && (
        <TrendChart trend={trend} currency={state.total.currency} mtd={state.total.mtd} />
      )}
      <Breakdown rows={state.breakdown} currency={state.total?.currency} />
      <p className="muted small list-label">{t('panelGroupListLabel')}</p>
      <ResourceTable resources={state.resources} />
      <Tips tips={state.tips} showResource />
      <Footer {...state} onRefresh={onRefresh} />
    </>
  );
}

/** The trend's figures, when they are in the currency shown above them. */
function usableTrend(trend: TrendState, currency: string) {
  if (trend.kind !== 'ready') return null;
  const { currency: trendCurrency } = trend.data;
  return trendCurrency === null || trendCurrency === currency ? trend.data : null;
}

/**
 * Like for like: this month's completed days against the same days of last
 * month. Until the trend is in (or on the 1st), the month-to-date against all
 * of last month, as before.
 */
function Comparison({
  trend,
  currency,
  fallback,
}: {
  trend: TrendState;
  currency: string;
  /** Shown while the trend loads or when it can't compare; omitted, nothing is shown. */
  fallback?: string;
}) {
  const sameDays = usableTrend(trend, currency)?.summary.sameDays;
  const days = usableTrend(trend, currency)?.summary.daysCompared ?? 0;
  if (!sameDays) {
    if (fallback === undefined) return null;
    return (
      <>
        <dt>{t('panelVsLastMonth')}</dt>
        <dd>{fallback}</dd>
      </>
    );
  }
  return (
    <>
      <dt>{tp('panelSameDaysLastMonth', days)}</dt>
      <dd>{formatMoney(sameDays.lastMonth, currency)}</dd>
      <dt>{tp('panelVsSameDays', days)}</dt>
      <dd>{changeText(changeFrom(sameDays.thisMonth, sameDays.lastMonth, currency))}</dd>
    </>
  );
}

const CHART = { width: 296, height: 64, pad: 2 } as const;

/**
 * Running total, day by day: this month (solid) over last month (dashed), and
 * the group's monthly budget as a line when it has one.
 */
function TrendChart({
  trend,
  currency,
  mtd,
}: {
  trend: TrendState;
  currency: string;
  /** Resource groups: this month so far, for the share of the budget used. */
  mtd?: number;
}) {
  if (trend.kind === 'failed') {
    return <p className="muted small section-label">{t('panelTrendUnavailable')}</p>;
  }
  const data = usableTrend(trend, currency);
  if (!data) return null;
  const { current, previous, daysInMonth } = data.summary;
  const budget = budgetFor(data.budget, currency);
  const lastCurrent = current[current.length - 1] ?? 0;
  const lastPrevious = previous[previous.length - 1] ?? 0;
  const top = Math.max(lastCurrent, lastPrevious, budget?.amount ?? 0);
  if (!(top > 0)) return null;

  const days = Math.max(daysInMonth, previous.length, 2);
  const x = (i: number) => CHART.pad + (i / (days - 1)) * (CHART.width - 2 * CHART.pad);
  const y = (v: number) =>
    CHART.height - CHART.pad - (Math.max(0, v) / top) * (CHART.height - 2 * CHART.pad);
  const line = (values: number[]) =>
    values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const label = t(
    'panelTrendLabel',
    formatMoney(lastCurrent, currency),
    formatMoney(lastPrevious, currency),
  );
  return (
    <>
      <p className="section-label">{t('panelTrendHeading')}</p>
      <svg
        className="trend"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        {budget && (
          <line
            className="trend-budget"
            x1={CHART.pad}
            x2={CHART.width - CHART.pad}
            y1={y(budget.amount)}
            y2={y(budget.amount)}
          />
        )}
        {previous.length > 1 && <polyline className="trend-previous" points={line(previous)} />}
        {current.length > 1 && <polyline className="trend-current" points={line(current)} />}
        {current.length === 1 && (
          <circle className="trend-dot" cx={x(0)} cy={y(current[0] ?? 0)} r={2} />
        )}
      </svg>
      <p className="trend-legend small muted">
        {/* Each key stays with its label when the legend wraps. */}
        <span>
          <span className="key current" aria-hidden="true" /> {t('thisMonth')}
        </span>
        <span>
          <span className="key previous" aria-hidden="true" /> {t('lastMonth')}
        </span>
        {budget && (
          <span>
            <span className="key budget" aria-hidden="true" />{' '}
            {mtd !== undefined
              ? t(
                  'panelBudgetUsed',
                  formatMoney(budget.amount, currency),
                  formatShare(mtd / budget.amount),
                )
              : t('panelBudget', formatMoney(budget.amount, currency))}
          </span>
        )}
      </p>
    </>
  );
}

/** A budget in another currency can't be drawn against these figures. */
function budgetFor(budget: MonthlyBudget | null, currency: string): MonthlyBudget | null {
  if (!budget) return null;
  return budget.currency === null || budget.currency === currency ? budget : null;
}

/** What azinfo can and can't do, next to every sign-in button (decision 008). */
export function TrustNote() {
  return (
    <p className="muted small trust">
      {t('signInTrustNote')}{' '}
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
        {t('privacyPolicy')}
      </a>
    </p>
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
                {/* Isolated: in Arabic the amount and the share must not reorder (decision 007). */}
                <bdi>{formatMoney(r.amount, currency)}</bdi> · <bdi>{formatShare(r.share)}</bdi>
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
        {tips.reason === 'noAccess'
          ? t('panelTipsNoAccess')
          : tips.reason === 'pending'
            ? t('panelTipsLoading')
            : t('panelTipsUnavailable')}
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

function Footer({
  fetchedAt,
  onRefresh,
  costType,
  refreshing,
  refreshFailed,
}: {
  fetchedAt: number;
  onRefresh: () => void;
  costType?: CostType;
  refreshing?: boolean;
  refreshFailed?: boolean;
}) {
  const time = formatTime(fetchedAt);
  return (
    <p className="muted small footer">
      {costType && <span className="cost-type">{costTypeLabel(costType)} · </span>}
      {refreshing
        ? t('panelRefreshing', time)
        : refreshFailed
          ? t('panelRefreshFailed', time)
          : t('updatedAt', time)}{' '}
      {!refreshing && (
        <button type="button" className="link" onClick={onRefresh}>
          {t('refresh')}
        </button>
      )}
    </p>
  );
}

export function costTypeLabel(costType: CostType): string {
  return costType === 'AmortizedCost' ? t('costTypeAmortized') : t('costTypeActual');
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
