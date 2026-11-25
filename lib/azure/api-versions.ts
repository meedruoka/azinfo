/** Pinned ARM api-versions, each checked against Microsoft Learn when set. */
export const API_VERSIONS = {
  /** Subscriptions - List. Checked 2026-10-04. */
  subscriptions: '2022-12-01',
  /** Tenants - List. Checked 2026-10-04. */
  tenants: '2022-12-01',
  /** Cost Management Query - Usage (GA). Checked 2026-10-04. */
  costQuery: '2026-06-01',
  /** Advisor Recommendations - List. Checked 2026-10-05. */
  advisor: '2025-01-01',
  /**
   * Consumption Budgets - List. Not checked against Microsoft Learn: the docs
   * were unreachable when this was added (decision 008).
   */
  budgets: '2023-05-01',
} as const;
