import type { NextRequest } from "next/server";
import { apiJson, apiError, OPTIONS, scopeMeta } from "@/lib/api";
import { filterEndpoints, searchEndpoints } from "@/lib/query";

export { OPTIONS };

// GET /api/search?q=...&category=&network=&protocol=&source=
// Fuzzy search over name/description/url, composable with the same filters.
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  if (!q || !q.trim()) return apiError("Missing required query parameter `q`");

  const base = filterEndpoints({
    category: sp.get("category"),
    network: sp.get("network"),
    protocol: sp.get("protocol"),
    source: sp.get("source"),
  });
  const endpoints = searchEndpoints(q, base);

  return apiJson({
    query: q,
    count: endpoints.length,
    ...scopeMeta(),
    endpoints,
  });
}
