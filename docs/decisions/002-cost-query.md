# 002: Cost query shape, column detection and throttling

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

M2 needs month-to-date and last-month actual cost per resource for a
subscription, without one request per resource page view. Cost Management
throttles heavily, names its cost column differently depending on the billing
agreement, and returns resource IDs in lowercase.

## What the documentation says

Checked 2026-10-04 on [Query - Usage](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage):

- `POST {scope}/providers/Microsoft.CostManagement/query`, current GA
  `api-version=2026-06-01`.
- `properties.columns` (name and type) and `properties.rows`. Column order
  isn't guaranteed.
- `properties.nextLink` for paging. The documented nextLinks carry an older
  api-version (`2021-10-01`) and a `$skiptoken`, so they are followed as
  returned.
- HTTP **204** is a documented response.
- The examples aggregate `PreTaxCost` (legacy agreements). Microsoft Customer
  Agreement data uses `Cost`.
- The rate-limit reference page (`automate/manage-automation`) now returns
  404. Microsoft Q&A answers show 429 responses with several
  `x-ms-ratelimit-microsoft.costmanagement-*-retry-after` headers (qpu,
  entity, tenant, client).

## Decision

1. **One query per subscription:** a custom range from the 1st of last month
   (UTC) to the end of today (UTC), `granularity: Monthly`, `ActualCost`,
   grouped by `ResourceId`. Rows are split into month-to-date and last month
   by their month column.
2. **Cost column:** request `Cost` first. On HTTP 400, retry once with
   `PreTaxCost` and remember the accepted name per subscription.
3. **Columns found by name, case-insensitive:**
   - cost: `Cost`, `PreTaxCost`, `TotalCost`, `CostInBillingCurrency`
   - currency: `Currency`, `BillingCurrency`
   - resource: `ResourceId`
   - month: `BillingMonth`, `UsageDate`, `BillingPeriod`

   A missing column or a non-numeric cost is an error, never a guess. Rows
   without a resource ID (for example support plans) are skipped.
4. **Throttling:** on 429 or 503, wait for the largest of `Retry-After` and
   every `x-ms-ratelimit-microsoft.costmanagement-*-retry-after` header, at
   least 5 s, doubling each attempt, with at most 3 retries. A requested wait
   over 60 s is reported as "rate limited" instead of waited out.
5. **Cache:** 4-hour TTL per subscription in `chrome.storage.local`
   (`cost.v1.<subscriptionId>`). Concurrent callers share one request.
   Sign-out clears it.
6. **Safety:** the client only POSTs to
   `/subscriptions/{id}/providers/Microsoft.CostManagement/query` on
   `management.azure.com`. Paging that repeats or passes 50 pages fails rather
   than returning partial totals.

## Test results

Personal subscription, 2026-10-04, Chrome:

| Check | Result |
|---|---|
| Top 5 matches Cost analysis (this month, actual cost, by resource) | Pass |
| Second popup open within the TTL makes no `query` request | Pass |
| Simulated 429 (`WXT_DEV_SIMULATE_429`) shows "rate limited, retrying", then data | Pass |
| Cost column accepted by this subscription | `Cost`, first try (no 400 fallback) |
| Response `columns` layout | `Cost:Number`, `BillingMonth:Datetime`, `ResourceId:String`, `Currency:String` (MCA-style), 1 page |

The layout was recorded from the `[azinfo] cost query` console line, which
logs column names and counts only. `tests/fixtures/cost-query-real-layout.json`
uses that exact layout with synthetic values. The legacy (`PreTaxCost`,
numeric `UsageDate`) and wider MCA fixtures are hand-made from the
documentation. The `PreTaxCost` path is still unverified against a real
legacy subscription.

## Consequences

- One query per subscription per 4 hours, whether the popup or the portal
  panel asks.
- Amortized cost and other cost types are a later setting; only `type`
  changes.
- If Azure ever rejects `granularity: Monthly` with a custom range, the
  fallback is two queries (`MonthToDate`, `TheLastMonth`). That isn't
  implemented, because it wasn't needed.
