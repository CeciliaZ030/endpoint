import { apiJson, OPTIONS, scopeMeta } from "@/lib/api";
import { getHosts, getHostCount } from "@/lib/hosts";
import { liveTotals } from "@/lib/live-catalog";

export { OPTIONS };

// GET /api/hosts — per-host route aggregation (routes, top category, median
// price), most routes first.
export async function GET() {
  const hosts = getHosts();
  const live = await liveTotals();
  return apiJson({
    host_count: getHostCount(),
    total_routes: hosts.reduce((s, h) => s + h.count, 0),
    // host_count is the hosts present in the BUNDLED subset. The catalog's own
    // host count comes from the daily snapshot, which is computed from the
    // full catalog — see /api/stats and data/stats/*.json.
    catalog_host_count: live.hostCount,
    ...(await scopeMeta()),
    hosts,
  });
}
