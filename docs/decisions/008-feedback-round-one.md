# 008: First user feedback: trust line, amortized cost, quick answers, daily trend, budgets

- **Status:** Implemented on `claude/nice-gauss-q3piow`; not released. Every part below works in
  the tests and on the sample page; none of it has been checked on a real subscription yet (see
  [Checks on a real subscription](#checks-on-a-real-subscription)).
- **Date:** 2026-11-25

## Context

The first public post about azinfo got four comments. Two were detailed and useful:

1. Show the exact permission in plain words where people sign in. Work admins approve
   extensions on that, and the public code.
2. Offer **amortized cost**: with reservations and savings plans, the actual-cost number
   misleads (a reserved VM looks nearly free).
3. A **30-day trend with a budget line**: one month-to-date number doesn't show creep.
4. On the 3rd of the month the month-to-date looks cheap. Put **last month at the same point**
   beside it.
5. **Speed is the pitch**: the panel has to paint at once.

The other two: a generic reply with an advertisement (ignored), and a question about release
provenance and verifiable packages, which 0.1.4 already answers with artifact attestations. This
round adds a way to compare a store-installed copy with the release package.

## Microsoft documentation

learn.microsoft.com couldn't be reached from the environment this was built in. What follows is
from earlier knowledge, not checked against the docs on this date. Each item is on the
real-subscription checklist below.

- Cost Management `Query - Usage` accepts `type: AmortizedCost` with the same body as
  `ActualCost`, `granularity: Daily` (date column `UsageDate`, a number such as `20261103`), and a
  `dataset.filter` of `{ dimensions: { name, operator: 'In', values } }`. The query also runs at
  resource-group scope (`/subscriptions/{id}/resourceGroups/{name}/providers/...`).
- `Budgets - List` (`Microsoft.Consumption/budgets`, `api-version=2023-05-01`) at resource-group
  scope returns `properties.amount`, `category`, `timeGrain`, `currentSpend` and an optional
  `filter`.
- Cost Management Reader includes `Microsoft.Consumption/*/read`, so it can read budgets. If it
  can't, the budget line just doesn't appear.

## Decision

1. **Trust line.** Under every sign-in button (popup and panel): "Read-only: azinfo needs the
   Cost Management Reader role (or Reader) and never changes anything in Azure. Cost data goes
   straight from Microsoft to this browser." Below it is a link to the privacy policy. The role
   name stays in English in every language (as in 005), and the locale test enforces it.
2. **Cost type setting.** On the options page, **Actual cost** (the default, unchanged) or
   **Amortized cost**. Only the query's `type` changes. Each type has its own cache entry
   (`cost.v3.<type>.<subscription>`), so switching back is instant while the cache is fresh. The
   panel and popup footers name the type in use.
3. **Quick answers from old data.** The panel first asks with `staleOk`. If the cache has an
   expired entry from this UTC month, the worker answers at once with it, plus whatever Advisor
   tips are stored, without calling Azure. The panel shows it with "Showing figures from 09:45
   while they refresh…" and asks again normally. If the refresh is throttled or fails, the old
   figures stay, marked "Couldn't refresh". If it says the user is signed out or has no access,
   that replaces them. An entry from a previous month is never shown (its "this month" is last
   month). An empty cache behaves as before.
4. **Daily trend, after the main figures.** A separate `getTrend` request is sent only once the
   main figures are on screen, so it never delays them and its query never competes with the
   main one. It runs one query per resource (subscription scope, filtered on `ResourceId`,
   lowercase) or per resource group (at the group's scope, no filter): `Daily`, from the 1st of
   last month to today, no grouping, so a few dozen rows at most. It is cached per target and
   cost type (`trend.v1.`) with the same cache period and the same new-month rule. `Cost` is
   tried first, then `PreTaxCost` after a 400. If it fails, the panel says "Daily trend
   unavailable" and keeps the old comparison.
   - **Like for like.** Once the trend is in, "So far vs. all of last month" becomes two rows:
     "Last month, first N days" and "This month vs the same N days". N is the number of completed
     UTC days. Today is left out on both sides because its data is mostly missing. N is capped
     at last month's length (30 March compares with all of February). The 1st has no comparison
     and keeps the old row.
   - **Chart.** It shows the running total day by day: this month solid and last month dashed, on
     one scale. This matches Cost analysis's "Accumulated costs" view, and a monthly budget can
     be drawn on it as a line. A daily-bars sparkline was the other option. It shows spikes better
     but can't carry a monthly budget, and the spike flag already covers spikes. The time axis
     runs left to right in Arabic too, as Cost analysis does.
5. **Budget line, resource groups only.** The group view reads the group's budgets (one GET,
   cached with the trend) and draws the lowest **monthly cost budget with no filter** as a dotted
   line, with "Budget X (Y% used)". Budgets with a filter cover only part of the group, and
   budgets set on a single resource are rare. So the resource view shows no budget rather than a
   misleading one. A budget failure (no access, none set) only hides the line.
6. **New read-only calls, no new permissions.** One more GET (budgets) and the query at
   resource-group scope. The client still allows only the query path for POST. The resource-group
   name is URL-encoded, and `.` and `..` are refused because URL parsing would resolve them away.
   The manifest is unchanged.
7. **Comparing a store copy with a release.** `scripts/compare-builds.mjs` compares an unzipped
   release package with the folder the browser installed. It leaves out what the stores add
   (`_metadata/`, the manifest's `update_url` and `key`). Documented in the README.

## Not done

- **A Firefox package.** One comment asked for "verifiable .xpis", which is Firefox's format.
  azinfo targets Chrome and Edge. A Firefox port would need its own sign-in redirect and store
  listing, and is a separate decision.
- **A budget per resource set inside azinfo.** It would be a figure Azure doesn't know about,
  stored only in this browser. Waiting to see if people ask for it.
- **A survey inside the extension.** It would contradict "no analytics". Feedback goes to GitHub
  issues.
- **Quick answers in the popup.** The popup's top 5 still loads as before.

## Checks on a real subscription

| # | Check | Result |
|---|---|---|
| 1 | Amortized cost: the panel's month-to-date matches Cost analysis → Amortized cost, by resource | Not run |
| 2 | `[azinfo] trend query` logs a `UsageDate` column and about 30–60 rows for one resource | Not run |
| 3 | The `ResourceId` filter matches with a lowercase ID (the trend isn't empty for a resource that has costs) | Not run |
| 4 | Group trend at resource-group scope matches Cost analysis → Accumulated costs for that group | Not run |
| 5 | `[azinfo] budgets` with a whole-group monthly budget: the line and "% used" match the Budgets blade | Not run |
| 6 | With the cache expired, reopening a resource shows "…while they refresh" at once, then the new figures | Not run |
| 7 | `scripts/compare-builds.mjs` on the next release zip and the copy installed from each store reports "Identical" | Not run |

## Consequences

- One more Cost Management query per resource or group opened per cache period (small, and
  only after the main figures). Throttling there only hides the trend.
- Cache keys moved to `cost.v3` (cost type in the key): the first view after updating fetches
  again.
- 20 new UI strings in 15 languages. These are machine-quality drafts, waiting for native review
  as in 005 and 007.
