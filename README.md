# x402 Endpoint

**6 directories. 1 catalog.**

**Live product:** https://endpoint.x402jp.com/

This repository is the source for x402 Endpoint's public catalog, REST API,
and MCP server. The catalog is refreshed by the scheduled workflow; see the
`last_seen` field on individual records for each endpoint's observed freshness.

A cross-directory unified catalog of x402 ecosystem endpoints. The x402
ecosystem has several community-maintained directories running in parallel;
this is a static site that aggregates them into a single browsable catalog so
you don't have to check each one individually.

Aggregated directories:

| Source | Site | Fetcher |
| --- | --- | --- |
| x402 Inc. (self-curated) | https://x402jp.com | ✅ seed (`data/seed/x402-inc.json`) |
| Community PR submissions | This repository | ✅ seed (`data/seed/community.json`) |
| x402scan (Merit Systems) | https://x402scan.com | ✅ implemented |
| Onyx Bazaar (CDP discovery) | https://onyx-actions.onrender.com/bazaar | ✅ implemented |
| Pay.sh (Solana) | https://pay.sh | ✅ implemented (pay-skills catalog) |
| Agentic.Market (Base) | https://agentic.market | stub (dynamic; data via CDP Bazaar) |
| Ampersend | https://app.ampersend.ai/discover | stub (no public API) |
| Visa CLI Merchant Registry | https://app.visacli.sh/merchants | stub (invite-only) |
| Circle Agent Marketplace | https://agents.circle.com | stub (dynamic) |

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS**
- **Fuse.js** for client-side search
- Deployed on **Vercel**

## Architecture

Static site + daily batch fetch:

1. **`scripts/fetch-directories.ts`** runs each per-directory fetcher, dedupes
   by canonical URL, merges cross-directory duplicates, and writes **two**
   files (see [Two catalog files](#two-catalog-files)):
   **`data/endpoints_full.json.gz`** (everything) and **`data/endpoints.json`**
   (the capped subset the site bundles). Every run records a per-source
   `fetch_report` (see [Fetch coverage](#fetch-coverage-and-the-2026-09-22-break)).
2. **Next.js pages** read `data/endpoints.json` in server components and render
   it. Pages use ISR (`revalidate = 86400`) so they refresh at most once a day.
3. **GitHub Actions** (`.github/workflows/daily-fetch.yml`) runs the fetch on a
   daily cron, commits the updated JSON, and pushes — Vercel redeploys on push.

```
scripts/
  fetch-directories.ts      # orchestrator: collect → dedupe → write both files
  page-subset.ts            # which endpoints the bundled file may carry
  read-catalog.mjs          # reads a catalog file, gunzipping a .gz
  brands.mjs                # is this host really the company's, or just named after it
  write-providers.mjs       # data/providers.json — named providers, from the full catalog
  find-brands.mjs           # the same check as a report
  compare-catalogs.mjs      # before/after diff of two catalogs
  util.ts                   # canonical URL, hashing, merge, throttle
  fetchers/
    x402scan.ts             # one fetcher per directory (currently stubs)
    agentic-market.ts
    pay-sh.ts
    ampersend.ts
    visa-cli.ts
    circle-marketplace.ts
src/
  app/
    page.tsx                # top: stats + filters + catalog
    network/[name]/page.tsx # endpoints by network
    category/[name]/page.tsx# endpoints by category
    directory/[name]/page.tsx# endpoints by source directory
    about/page.tsx          # sources, update frequency, disclaimer
  components/               # cards, grid, filters, stats, footer
  lib/                      # types + data-access helpers
data/
  endpoints_full.json.gz    # every endpoint — the real catalog, not bundled
  endpoints.json            # the capped subset the site imports at build time
  providers.json            # named providers, derived from the full catalog
  stats/                    # daily snapshots, counted from the full catalog
```

## Two catalog files

The fetch writes both of these on every run:

| file | holds | who reads it |
| --- | --- | --- |
| `data/endpoints_full.json.gz` | **every** endpoint, gzipped | `scripts/write-stats-snapshot.mjs`; anyone asking how big x402 actually is. **Nothing under `src/` imports it.** |
| `data/endpoints.json` | a subset, at most `subset_limit` (20,000) | `src/lib/data.ts` — the site, its pages and its REST API |

They exist separately because of how the site is built. `src/lib/data.ts`
imports `data/endpoints.json` **at build time** and `src/app/page.tsx` passes
the result to `<CatalogExplorer>`, a client component — so every endpoint in
that file is serialized into the page payload. ~19k endpoints (~490 bytes
each) is the proven-safe figure against Vercel's ~19 MB ISR limit, and that is
what the x402scan fetcher's old `MAX_ENDPOINTS = 20000` was really protecting.
Removing the fetch cap without splitting the files would have broken the build.

The subset is `every non-x402scan endpoint, then the most recently updated
x402scan ones (last_seen desc) up to the limit` — the old behaviour was
"the first 20,000 x402scan rows by lastUpdated desc", so the freshest 20,000
keeps the deployed page equivalent. The other directories are always kept
(there are under a hundred, and the x402-inc seed is featured in the UI), and
selection runs after the cross-source merge so a URL several directories list
is never dropped as "just x402scan".

`data/endpoints.json` marks itself: `subset_of`, `subset_limit`, `subset_rule`
and `full_count` are all present, so its `count` can never be mistaken for an
ecosystem total. `write-stats-snapshot.mjs` refuses to count a file carrying
`subset_of`.

**Why the full file is gzipped.** It is committed on every daily run, and at
~66 MB of pretty-printed JSON a day that would outgrow the repository within
months. `gzip -9` takes it to ~5 MB (~7%) in a fraction of a second, and Node
zeroes the gzip header's mtime, so identical data still compresses to identical
bytes and an unchanged catalog produces no diff. Read it with
`scripts/read-catalog.mjs` (or `gunzip -c data/endpoints_full.json.gz | jq .`);
an uncompressed `data/endpoints_full.json` is still accepted if present, so a
checkout from before the change keeps working.

**Two consequences to know about.** `data/stats/*.json` is computed from the
full file while the site shows the subset, so the site's own counter and the
snapshots will disagree — the snapshots are the true ones. And the REST API
under `src/app/api/` reads the same bundled subset, so it serves the subset
too; making it serve all of x402 means reading the full file at request time
(or a database), which is a front-end/runtime change and is deliberately not
done here.

To raise the cap, move the homepage's search to `/api/search` and paginate the
list server-side, then change `PAGE_SUBSET_MAX` in `scripts/page-subset.ts`.

## Named providers

The homepage leads with **who serves x402 under their own name**, above the
ranking, from `data/providers.json`.

The list exists because the catalog cannot tell you this by itself. Anyone can
publish an endpoint titled "CoinGecko Price API" on their own domain, and the
catalog records it as faithfully as the real one — so reading endpoint titles
for "which companies are on x402" produces claims that do not survive a reader
clicking the link. `scripts/brands.mjs` applies one rule instead: a host counts
as a company's own **only when it sits under a domain that company controls**.

Three kinds of host are therefore excluded, however they are titled:

- **Gateway operators** that resell someone else's API — PaySponge, Locus,
  x402 Atlas, PayWeave, fetcher.sh, and `gateway-402.com` (the Solana
  Foundation's own gateway, which fronts Google Cloud and Alibaba Cloud APIs).
  `coingecko.x402.paywithlocus.com` is Locus's endpoint, not CoinGecko's.
- **Shared hosting** — `*.vercel.app`, `*.trycloudflare.com`,
  `*.supabase.co`, `ec2-….amazonaws.com` and friends say nothing about who
  operates the endpoint, including for the platform itself.
- **Names merely contained in a host**, e.g. `x402nansen….vercel.app`.

`scripts/find-brands.mjs` prints both sides of that split for a catalog, with
the excluded hosts named so they can be checked rather than taken on trust.

The artifact is built from **`data/endpoints_full.json.gz`**, not from the file
the site bundles: the bundled subset is capped at 20,000 of ~105,000 endpoints,
and deriving the list from it finds 8 companies where the full catalog has 13.
`providers.json` records `scanned` and `subset` so the page can state what its
counts came from.

## Unified data format

See `src/lib/types.ts`. Each entry:

```ts
type Endpoint = {
  id: string;            // stable hash of the canonical URL
  url: string;
  name: string;
  description: string;
  category: "data" | "compute" | "search" | "media" | "trading" | "messaging" | "other";
  price?: { amount: number; currency: string; unit: string };
  networks: string[];    // Base, Solana, Polygon, ...
  protocols: string[];   // x402, MPP, L402
  source: DirectorySource[]; // every directory the URL was seen in
  source_url: string;
  last_seen: string;     // ISO 8601
};
```

When the same URL appears in multiple directories the records are merged and
`source` holds every directory it was seen in.

## Fetch coverage, and the 2026-09-22 break

**Runs from 2026-09-22 onward fetch x402scan in full. Earlier runs did not.**

Until 2026-09-22 the x402scan fetcher stopped after 20,000 rows (a
`MAX_ENDPOINTS` constant in `scripts/fetchers/x402scan.ts`). Every healthy run
from 2026-08-07 on therefore reported exactly 20,000 for that source — the
number was the cap, not the directory. x402scan's API has no such limit
(`paginatedQuerySchema` puts no upper bound on `page_size`, and the query is a
plain Prisma `skip`/`take`), so the fetcher now pages until the list is
exhausted.

**Do not compare totals across that boundary without saying so.** The catalog
count and everything derived from it — `data/stats/*.json`, host counts,
category and price-tier splits — change scale on that date because coverage
changed, not because the ecosystem did. The daily snapshots on either side are
each internally consistent; a trend line that crosses 2026-09-22 is not.

Each run records its own coverage in `fetch_report`, so a short catalog can
never look like a healthy one:

| field | meaning |
| --- | --- |
| `rows` | rows the upstream API actually served (x402scan keys rows by URL + method, so one URL can appear more than once) |
| `count` | endpoints the fetcher returned |
| `unique_after_dedup` | distinct canonical URLs in those, before the cross-source merge |
| `pages` | requests made |
| `api_total` | the upstream's own `total_count`, when it reports one |
| `truncated` | **true when the run did not reach the end of the list** — a safety limit, a depth ceiling, or a page that kept failing |
| `stopped_reason` | `exhausted` (complete), `safety_limit`, `page_ceiling`, or `page_error` |
| `slices` | per-pass counts when one pass wasn't enough |

The fetcher pages by a **`lastUpdated` cursor**, not by a growing offset. The
upstream query is `skip: page * page_size`, so plain offset paging asks for
`OFFSET 125000` by the end of a 500-page crawl — and on 2026-10-01..03 that is
exactly what started failing, the crawl dying earlier each day as the directory
grew. A cursor keeps every request at `skip: 0` and filters with
`where: { lastUpdated: { lte: cursor } }` instead (`where` is a pass-through
Prisma filter upstream). The filter is `lte`, not `lt`, so rows sharing one
timestamp are never skipped; the cost is one duplicate row per page, which
dedupe absorbs. `X402SCAN_PAGING=offset` restores the old behaviour for
comparison.

The fetcher pages `lastUpdated desc` with a ≥1s gap between requests, retries
429/5xx with exponential backoff (honouring `Retry-After`), and stops at a
200,000-row safety limit that reports `truncated: true` rather than quietly
returning a short catalog. If the API ever does impose a depth ceiling, the
run re-reads the list in the other sort orders and unions by canonical URL,
recording each slice. Knobs: `X402SCAN_PAGE_SIZE`, `X402SCAN_GAP_MS`,
`X402SCAN_SAFETY_MAX`.

`.github/workflows/verify-fetch.yml` runs the live fetchers and diffs the
result against the committed catalog **without committing or deploying**, for
checking a fetcher change before the daily job pushes it.

### A partial fetch never replaces a complete catalog

**2026-10-01 to 10-03: three runs published gutted catalogs** — 19,402, then
17,812, then 7,995 endpoints, against a directory of ~132,000. The site, the
daily stats and the providers list all followed them down. Each run recorded
`truncated: true` correctly. Nothing acted on it.

`scripts/catalog-guard.ts` now decides whether a run may be published:

| run | verdict |
| --- | --- |
| complete | publish, even if the catalog shrank (upstream deprecations are real) |
| truncated, and below 98% of the previous count | **refuse** — keep the previous catalog, record `degraded` |
| truncated, but not smaller | publish, still marked `degraded` |
| collected nothing | keep the previous catalog |

A refused run still commits its `fetch_report`, so the failure is visible in
the artifact rather than only in a run log that rotates away — and
`fetch_report.errors` now carries the actual HTTP errors, not just
`stopped_reason: "page_error"`.

When a catalog is `degraded`, `write-stats-snapshot.mjs` writes **no snapshot
for that day** and `write-providers.mjs` leaves the previous artifact alone. A
missing day is already a supported state in the series; a wrong day is not. The
three corrupted snapshots from 2026-10-01..03 were deleted for the same reason
— they could not be recomputed, because no complete catalog exists for those
dates.

### Nothing reviewed is left outside `main`

PR #24 was squash-merged. Squashing rewrites a branch into one new commit, so
three commits pushed to that branch *after* the merge button were never in
`main` — and nobody noticed for nine days, during which the daily job ran older
code than had been reviewed.

`.github/workflows/unmerged-check.yml` runs `scripts/check-unmerged.mjs` on
every push to `main`, when a PR closes, and daily at 06:30 UTC. For each
recently merged PR it compares the branch against `head.sha` — the commit the
branch pointed at when it was merged — and fails if the branch gained anything
after that.

It stays quiet about the cases that are fine: a branch with an open PR (work in
progress), a branch already deleted (the normal resolution), and commits whose
patch is already on `main` via a later squash (`git cherry` compares by patch
id, not by SHA).

## Agent access (API + MCP)

The catalog is readable programmatically — no auth, CORS-open, edge-cached.

REST API (`src/app/api/`):

| Route | Description |
| --- | --- |
| `GET /api/endpoints` | All endpoints; filter by `category`, `network`, `protocol`, `source` |
| `GET /api/endpoints/:id` | A single endpoint |
| `GET /api/search?q=` | Fuzzy search (Fuse.js) |
| `GET /api/stats` | Aggregate counts |
| `GET /api/openapi.json` | OpenAPI 3.1 spec |

A light, best-effort per-IP rate limit lives in `src/middleware.ts` (in-memory,
no external store; returns `429` + `Retry-After` past the window). See
[`For Agents`](https://endpoint.x402jp.com/#for-agents) for usage.

MCP server: the [`mcp/`](./mcp) package (`x402-endpoint-mcp`) exposes
`list_endpoints`, `search_endpoints`, `get_endpoint`, and `get_stats`, backed by
the REST API. See [`mcp/README.md`](./mcp/README.md) for client setup.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run fetch        # run the directory fetchers and rebuild data/endpoints.json
npm run typecheck
npm run build
```

`data/endpoints.json` ships with sample data so the site renders before any
fetcher is implemented. The fetchers are currently stubs (`return []`) — the
orchestrator leaves the existing JSON untouched when nothing is fetched, so the
sample data survives until real fetchers land.

## Implementing a fetcher

Each fetcher exports an `async` function returning `Promise<Endpoint[]>` and
maps a directory's listings into the unified shape. When implementing:

- **Prefer a public API.** x402scan, Agentic.Market, and Circle are likely to
  offer APIs (GraphQL or REST) — use those over HTML scraping.
- **Respect `robots.txt` and terms of service.** Don't scrape where it's
  disallowed. The Visa CLI Merchant Registry is invite-only; confirm the
  merchant list may be republished before enabling that fetcher.
- **Be polite.** Keep at least 1 second between requests (`sleep` in
  `scripts/util.ts`).
- **Fail soft.** Throwing from a fetcher only skips that directory; the rest
  still run.
- For directories that can't be fetched automatically, maintaining a manual
  JSON is an acceptable fallback.

## x402 Inc. endpoints (seed source)

This catalog is built by [x402 Inc.](https://x402jp.com), which also ships its
own x402 endpoints. Those are included here as a **seed source**
(`source: ["x402-inc"]`), maintained by hand in `data/seed/x402-inc.json` and
loaded by the `x402-inc` fetcher (`scripts/fetchers/x402-inc.ts`). Modeling
them as a fetcher means they flow through the same dedupe/merge as every other
directory — if x402scan or Onyx Bazaar also list one of these URLs, the entry's
`source` becomes e.g. `["x402-inc", "onyx-bazaar"]`.

### Featuring & disclosure

x402 Inc. operates this catalog and **features its own endpoints**:

- They are styled in gold and pinned to the top of listings
  (`src/lib/featured.ts` + `EndpointCard`). This is openly disclosed on the
  About page rather than hidden.
- The **third-party directories are aggregated on equal footing** with no
  preferential ranking between them.
- x402 Inc. endpoints are still listed under their own `x402-inc` source and
  remain subject to dedupe; a URL also found in a third-party directory shows
  both sources.

## Contributing

No sign-up, submission form, or dynamic features. To add or correct an
endpoint, open a pull request — everything is PR-based.

For a service absent from the aggregated directories, edit
`data/seed/community.json` rather than the generated catalog files. Include the
public endpoint, accurate network and price, and a reproducible unpaid 402
probe in the PR. A body-bound POST should be described as such; a submitted
entry does not imply that this catalog has paid or verified the service.

## Deployment

Connect the repo to Vercel with **Production Branch = `main`**. The daily GitHub
Actions job (`.github/workflows/daily-fetch.yml`) fetches, writes a stats
snapshot, and commits `data/endpoints.json`, `data/endpoints_full.json.gz` and
`data/stats/` to `main`.

Because the site imports `data/endpoints.json` **at build time**, the front only
updates on a fresh deploy — ISR revalidation alone won't change the numbers. To
guarantee a rebuild on each daily commit, the workflow can call a **Vercel
Deploy Hook**:

1. Vercel → Project → Settings → Git → **Deploy Hooks** → create one for `main`.
2. GitHub → repo → Settings → Secrets and variables → Actions → add
   `VERCEL_DEPLOY_HOOK` = the hook URL.

When set, the cron POSTs the hook after pushing (only when data changed). If the
secret is absent, it falls back to Vercel's Git auto-deploy — so make sure that
is enabled and pointed at `main` if you don't use the hook.

## Disclaimer

- Data reflects each directory as of its fetch time (shown in the footer).
- Accuracy and availability of each endpoint depend on the originating
  directory.
- Use of any endpoint is subject to that endpoint's own terms of service.
- This site is informational and is **not investment advice**.
