import type { NextRequest } from "next/server";
import { apiJson, OPTIONS, scopeMeta } from "@/lib/api";
import { filterEndpoints } from "@/lib/query";
import { getCatalog } from "@/lib/data";

export { OPTIONS };

// GET /api/endpoints?category=&network=&protocol=&source=
// Returns all catalog endpoints, optionally filtered (filters are AND-combined).
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = {
    category: sp.get("category"),
    network: sp.get("network"),
    protocol: sp.get("protocol"),
    source: sp.get("source"),
  };
  const endpoints = filterEndpoints(filters);
  return apiJson({
    generated_at: getCatalog().generated_at,
    count: endpoints.length,
    filters: Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v != null),
    ),
    ...scopeMeta(),
    endpoints,
  });
}
