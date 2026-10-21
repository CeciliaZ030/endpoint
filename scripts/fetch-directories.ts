// Aggregates every directory fetcher into a single unified catalog and writes
// data/endpoints.json.
//
// Run with: npm run fetch  (tsx scripts/fetch-directories.ts)
//
// Behaviour:
//  - Each fetcher runs independently. If one throws, the others still run, but
//    the outcome is recorded in `fetch_report` — an implemented fetcher that
//    silently returns 0 is detectable (status "empty"), not hidden.
//  - Records are deduped by canonical URL; duplicates across directories are
//    merged so `source` becomes the union of directories the URL was seen in.
//  - `fetch_report` and `popularity_coverage` are ALWAYS written.

import { writeFile, readFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  Catalog,
  Endpoint,
  FetchReportEntry,
  FetchStatus,
} from "../src/lib/types";
import { canonicalUrl, hashId, mergeEndpoints } from "./util";
import { PAGE_SUBSET_MAX, SUBSET_RULE, pageSubset } from "./page-subset";
import { assessRun } from "./catalog-guard";
import { appendAll } from "./append-all";

import { fetchX402Inc } from "./fetchers/x402-inc";
import { fetchCommunity } from "./fetchers/community";
import { fetchX402scan, getLastX402scanRun } from "./fetchers/x402scan";
import { fetchOnyxBazaar } from "./fetchers/onyx-bazaar";
import { fetchAgenticMarket } from "./fetchers/agentic-market";
import { fetchPaySh } from "./fetchers/pay-sh";
import { fetchAmpersend } from "./fetchers/ampersend";
import { fetchVisaCli } from "./fetchers/visa-cli";
import { fetchCircleMarketplace } from "./fetchers/circle-marketplace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
// Every endpoint. Nothing in src/ imports this — it is the input to
// scripts/write-stats-snapshot.mjs and the answer to "how big is x402 really".
//
// Stored gzipped because it is committed daily: ~66 MB of pretty-printed JSON
// per day would outgrow the repo within months, and gzip -9 takes it to ~5 MB
// (~7%) in a fraction of a second. Node zeroes the gzip header's mtime, so the
// bytes are deterministic and an unchanged catalog still produces no diff.
const OUT_FULL = join(DATA, "endpoints_full.json.gz");
// Read-only fallback for a checkout written before the file was gzipped.
const OUT_FULL_LEGACY = join(DATA, "endpoints_full.json");
// The subset the site bundles. src/lib/data.ts imports this at build time and
// src/app/page.tsx hands it to a client component, so every byte here lands in
// the page payload — hence the cap.
const OUT_PAGE = join(DATA, "endpoints.json");

type NamedFetcher = {
  name: string;
  run: () => Promise<Endpoint[]>;
  // Implemented fetchers set this true: a 0 result is then "empty" (a bug to
  // surface), not silently accepted. Stub fetchers set it false → "stub".
  expectNonEmpty: boolean;
  // Paging fetchers expose how the run went (pages, upstream total, whether it
  // reached the end) so `fetch_report` can carry it. Read after `run`.
  meta?: () => Partial<FetchReportEntry> | undefined;
};

const FETCHERS: NamedFetcher[] = [
  { name: "x402-inc", run: fetchX402Inc, expectNonEmpty: true },
  { name: "community", run: fetchCommunity, expectNonEmpty: false },
  {
    name: "x402scan",
    run: fetchX402scan,
    expectNonEmpty: true,
    meta: () => {
      const r = getLastX402scanRun();
      if (!r) return undefined;
      return {
        rows: r.rows,
        pages: r.pages,
        truncated: r.truncated,
        api_total: r.api_total,
        stopped_reason: r.stopped_reason,
        elapsed_ms: r.elapsed_ms,
        // Without these a failed run says "page_error" and nothing else, which
        // is not enough to tell a 429 from a 5xx a week later.
        errors: r.errors.length ? r.errors.slice(0, 10) : undefined,
        skipped_pages: r.skipped_pages || undefined,
        // Only worth recording when more than the primary pass ran.
        slices: r.sliced
          ? r.slices.map(({ label, rows, added, pages }) => ({
              label,
              rows,
              added,
              pages,
            }))
          : undefined,
      };
    },
  },
  { name: "onyx-bazaar", run: fetchOnyxBazaar, expectNonEmpty: true },
  { name: "pay-sh", run: fetchPaySh, expectNonEmpty: true },
  { name: "agentic-market", run: fetchAgenticMarket, expectNonEmpty: false },
  { name: "ampersend", run: fetchAmpersend, expectNonEmpty: false },
  { name: "visa-cli", run: fetchVisaCli, expectNonEmpty: false },
  {
    name: "circle-marketplace",
    run: fetchCircleMarketplace,
    expectNonEmpty: false,
  },
];

type CollectResult = { report: FetchReportEntry[]; endpoints: Endpoint[] };

async function collect(): Promise<CollectResult> {
  const report: FetchReportEntry[] = [];
  const endpoints: Endpoint[] = [];

  for (const f of FETCHERS) {
    // Only the fetch itself may fail. Everything after it is bookkeeping, and
    // when bookkeeping threw inside this `try` the source got TWO report
    // entries — an `ok` one and a `failed` one — while its endpoints were
    // dropped. One entry per source, always.
    let items: Endpoint[];
    try {
      items = await f.run();
    } catch (err) {
      const error = (err as Error).message;
      report.push({
        source: f.name,
        status: "failed",
        count: 0,
        error,
        ...(f.meta?.() ?? {}),
      });
      console.warn(`  ✗ ${f.name}: failed — ${error}`);
      continue;
    }

    let status: FetchStatus;
    if (items.length > 0) status = "ok";
    else status = f.expectNonEmpty ? "empty" : "stub";
    // Distinct canonical URLs this source contributed, before the
    // cross-source merge — so "20,000 rows" vs "18,400 endpoints" is
    // visible per source rather than only in the final count.
    const unique_after_dedup = new Set(
      items.map((e) => canonicalUrl(e.url)),
    ).size;
    report.push({
      source: f.name,
      status,
      count: items.length,
      unique_after_dedup,
      ...(f.meta?.() ?? {}),
    });
    const flag = status === "empty" ? "⚠" : status === "stub" ? "·" : "✓";
    console.log(`  ${flag} ${f.name}: ${items.length} (${status})`);
    // NOT `endpoints.push(...items)` — see scripts/append-all.ts.
    appendAll(endpoints, items);
  }

  return { report, endpoints };
}

// Dedup by canonical URL, normalize ids, and merge cross-directory duplicates.
function dedupe(endpoints: Endpoint[]): Endpoint[] {
  const byUrl = new Map<string, Endpoint>();
  for (const raw of endpoints) {
    const key = canonicalUrl(raw.url);
    const e: Endpoint = { ...raw, id: raw.id || hashId(raw.url) };
    const existing = byUrl.get(key);
    byUrl.set(key, existing ? mergeEndpoints(existing, e) : e);
  }
  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The previous catalog, from whichever of the three files exists. */
async function readPreviousCatalog(): Promise<Catalog | null> {
  for (const path of [OUT_FULL, OUT_FULL_LEGACY, OUT_PAGE]) {
    try {
      const raw = await readFile(path);
      const text = path.endsWith(".gz")
        ? gunzipSync(raw).toString("utf8")
        : raw.toString("utf8");
      return JSON.parse(text) as Catalog;
    } catch {
      // try the next one
    }
  }
  return null;
}

async function main() {
  console.log("Fetching x402 directories…");
  const { report, endpoints: collected } = await collect();

  const previous = await readPreviousCatalog();
  const previousEndpoints = previous?.endpoints ?? [];
  const previousCount = previous?.full_count ?? previousEndpoints.length;

  const fresh = collected.length > 0 ? dedupe(collected) : [];
  const { publish, degraded } = assessRun({
    freshCount: fresh.length,
    previousCount,
    report,
  });

  // A partial fetch must never replace a complete catalog (see
  // scripts/catalog-guard.ts). Keep the previous one and leave the reason in
  // the artifact, where it is committed rather than lost with the run log.
  const endpoints = publish ? fresh : previousEndpoints;
  if (!publish) {
    console.warn(
      `::error::Refusing to publish this run: ${degraded?.reason}. ` +
        `Collected ${degraded?.collected ?? 0} endpoint(s) against ${previousCount} ` +
        `previously${degraded?.sources.length ? ` (${degraded.sources.join(", ")})` : ""}. ` +
        "Keeping the previous catalog.",
    );
  }

  const popularity_coverage = endpoints.filter(
    (e) => e.popularity != null,
  ).length;
  const generated_at = new Date().toISOString();

  const full: Catalog = {
    generated_at,
    count: endpoints.length,
    fetch_report: report,
    popularity_coverage,
    ...(degraded ? { degraded } : {}),
    endpoints,
  };
  await writeFile(
    OUT_FULL,
    gzipSync(Buffer.from(JSON.stringify(full, null, 2) + "\n", "utf8"), {
      level: 9,
    }),
  );

  // The page file carries the same report and the same shape, plus the
  // subset markers, so nothing downstream can mistake its `count` for a total.
  const subset = pageSubset(endpoints);
  const page: Catalog = {
    generated_at,
    count: subset.length,
    fetch_report: report,
    popularity_coverage: subset.filter((e) => e.popularity != null).length,
    subset_of: "endpoints_full.json",
    subset_limit: PAGE_SUBSET_MAX,
    subset_rule: SUBSET_RULE,
    full_count: endpoints.length,
    ...(degraded ? { degraded } : {}),
    endpoints: subset,
  };
  await writeFile(OUT_PAGE, JSON.stringify(page, null, 2) + "\n", "utf8");

  console.log(
    `Wrote ${endpoints.length} endpoint(s) to endpoints_full.json.gz; ` +
      `popularity coverage ${popularity_coverage}.`,
  );
  console.log(
    subset.length < endpoints.length
      ? `Wrote ${subset.length} of them to endpoints.json (the page bundle's ` +
          `${PAGE_SUBSET_MAX} cap); stats are computed from the full file.`
      : `Wrote all ${subset.length} to endpoints.json (under the ${PAGE_SUBSET_MAX} cap).`,
  );
  console.table(report);

  // A short catalog must never look like a healthy one. Say so on stdout as
  // well as in fetch_report.
  for (const r of report) {
    if (!r.truncated) continue;
    console.warn(
      `::warning::${r.source} did NOT reach the end of its list (${r.stopped_reason}): ` +
        `${r.rows ?? r.count} row(s)` +
        (r.api_total != null ? ` of ${r.api_total} reported upstream` : "") +
        ". fetch_report records truncated: true." +
        (r.errors?.length ? ` First error: ${r.errors[0]}` : ""),
    );
  }
  if (degraded?.kept_previous) {
    console.warn(
      `::warning::Catalog NOT updated this run — kept the previous ` +
        `${degraded.previous} endpoint(s). Downstream artifacts are stale on purpose.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
