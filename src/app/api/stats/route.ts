import type { NextRequest } from "next/server";
import { apiJson, OPTIONS } from "@/lib/api";
import {
  getBundledCount,
  getCategoryCounts,
  getNetworks,
  getProtocols,
  getSourceCounts,
} from "@/lib/data";
import { buildSeries } from "@/lib/stats-history";
import { liveTotals } from "@/lib/live-catalog";

export { OPTIONS };

// Nothing here may be cached as a response: the figures below are fetched per
// request (see @/lib/live-catalog), and caching the response would re-freeze
// what that fetch exists to unfreeze. The fetch itself is cached for an hour.
export const dynamic = "force-dynamic";

// GET /api/stats?range=14d|30d|all
// Whole-catalog counts plus a daily time series (`points`) of committed
// snapshots and the list of `missing` dates.
export async function GET(req: NextRequest) {
  const live = await liveTotals();

  const { range, points, missing } = buildSeries(
    req.nextUrl.searchParams.get("range"),
  );

  // Prefer the snapshot's breakdowns: they are computed from the full catalog,
  // while the bundled fallbacks only see the 20,000-endpoint page subset.
  const snap = live.snapshot;
  const nonZero = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));

  const categories = snap?.byCategory
    ? nonZero(snap.byCategory)
    : nonZero(getCategoryCounts());
  const networks = snap?.byChain
    ? nonZero(snap.byChain)
    : Object.fromEntries(getNetworks().map((n) => [n.name, n.count]));
  const sources = snap?.bySource ? nonZero(snap.bySource) : getSourceCounts();

  return apiJson(
    {
      generated_at: live.generatedAt,
      // The catalog's real size. `browsable` is how much of it this deployment
      // bundles and can search; the difference is a page-payload limit, not
      // missing data.
      total: live.total,
      browsable: getBundledCount(),
      host_count: live.hostCount,
      sources,
      categories,
      networks,
      // No snapshot carries a protocol breakdown, so this one is still over
      // the bundled subset. Said plainly in `scopes` rather than left to be
      // discovered.
      protocols: Object.fromEntries(
        getProtocols().map((p) => [p.name, p.count]),
      ),
      // Which figures describe the whole catalog and which only the subset,
      // and whether these came from the repository or from this build.
      scopes: {
        full_catalog: snap
          ? ["total", "host_count", "sources", "categories", "networks"]
          : ["total", "host_count"],
        browsable_subset: snap
          ? ["protocols"]
          : ["protocols", "sources", "categories", "networks"],
        origin: live.origin,
        as_of: live.date,
      },
      // time series
      range,
      points,
      missing,
    },
    { cache: false },
  );
}
