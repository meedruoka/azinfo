# 004: Advisor savings tips and cost by meter

- **Status:** Implemented. The real response layouts are waiting for a manual check.
- **Date:** 2026-10-05

## Context

The panel says what a resource costs, but not why, or what to do about it. Azure Advisor already
computes cost recommendations, and Cost Management can split cost by meter category. Neither is
shown next to the resource in the portal.

## What the documentation says

Checked 2026-10-05:

- [Recommendations - List](https://learn.microsoft.com/en-us/rest/api/advisor/recommendations/list)
  (`2025-01-01`): `GET /subscriptions/{id}/providers/Microsoft.Advisor/recommendations`,
  `$filter` on `Category`, paged with `nextLink`. It "obtains cached recommendations"; computing
  new ones is a separate POST (`generateRecommendations`) that azinfo never calls. Each item has
  `resourceMetadata.resourceId`, `shortDescription.problem` / `.solution` and `impact`.
  `extendedProperties` is an undocumented free-form object.
- [Cost Management Reader](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/management-and-governance#cost-management-reader)
  includes `Microsoft.Advisor/recommendations/read`: anyone who can see costs can see the tips.
- [Query - Usage](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage)
  (`2026-06-01`): "Query can have up to 2 group by clauses."
- [Calculate cost savings](https://learn.microsoft.com/en-us/azure/advisor/advisor-how-to-calculate-total-cost-savings)
  talks about yearly savings but doesn't define the `extendedProperties` fields.

## Decision

1. **Advisor:** one GET per subscription with `$filter=Category eq 'Cost'`, cached with the cost
   TTL, grouped by lowercased resource ID. It runs alongside the cost query. A failure (no access,
   Advisor not set up) shows "Savings tips unavailable" and **never** fails the costs.
2. **Savings:** `annualSavingsAmount` + `savingsCurrency` → "Save ~X/year". When only
   `savingsAmount` is present, its period isn't documented, so it shows as "Estimated savings X"
   with no period. Group totals only add tips with the same currency and period.
3. **Meters:** the existing cost query groups by `ResourceId` **and** `MeterCategory`: still one
   query per subscription per TTL, no extra calls. The breakdown covers this month only.
4. **Fallback order** on HTTP 400 (remembered per subscription):
   Cost+MeterCategory → PreTaxCost+MeterCategory → Cost+ServiceName → PreTaxCost+ServiceName →
   Cost → PreTaxCost. Costs without a breakdown come last, so the breakdown can't lose the costs.
5. The cost cache key moved to `cost.v2` (the stored shape changed).

## Checks on a real subscription

| # | Check | Result |
|---|---|---|
| 1 | The service worker logs `[azinfo] cost query` with `meter: 'MeterCategory'` and a `MeterCategory` column | Passed 2026-11-19: `costColumn: 'Cost'`, `meter: 'MeterCategory'`, columns `Cost`, `BillingMonth`, `ResourceId`, `MeterCategory`, `Currency`; 9 rows, 1 page. The first query shape was accepted, no fallback |
| 2 | `[azinfo] advisor` logs the recommendation count and which savings fields exist | Passed 2026-11-19: `recommendations: 0`, `withResource: 0`, `savingsFields: []` |
| 3 | If tips exist: `savingsAmount` vs `annualSavingsAmount` match what the Advisor blade shows | Not testable yet: the test subscription has no Cost recommendations. Repeat when Advisor lists one |

## Consequences

- Cost responses are larger (one row per resource, meter and month). Paging already handles it.
- One more GET per subscription per cache period (Advisor). ARM read limits are generous.
- No new permissions, hosts or POST endpoints.
