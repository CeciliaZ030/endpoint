import { NextResponse } from "next/server";
import { getBundledCount, getTotalEndpoints, isBundledSubset } from "./data";

// The catalog only changes on redeploy (data is bundled at build time), so API
// responses are safe to cache hard at the edge for a day with SWR.
const CACHE = "public, s-maxage=86400, stale-while-revalidate=86400";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function apiJson(data: unknown, init?: { status?: number; cache?: boolean }) {
  const headers: Record<string, string> = { ...CORS };
  headers["Cache-Control"] = init?.cache === false ? "no-store" : CACHE;
  return NextResponse.json(data, { status: init?.status ?? 200, headers });
}

export function apiError(message: string, status = 400) {
  return apiJson({ error: message }, { status, cache: false });
}

// Shared preflight handler for the API routes.
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Scope of a response that can only see the bundled subset.
//
// data/endpoints.json is capped (`subset_limit`) because the home page passes
// it to a client component, so the whole file lands in the page payload. The
// catalog itself is far larger. Search, listing and host aggregation all run
// over the bundled array, so on 2026-10-07 they covered 20,000 of 131,675
// endpoints and 1,870 of 11,210 hosts — and said nothing about it, which
// reads as "this is everything".
//
// Every subset-scoped response carries this, so a caller can tell coverage
// from absence without reading our source.
export function scopeMeta() {
  const browsable = getBundledCount();
  const total = getTotalEndpoints();
  if (!isBundledSubset()) {
    return { scope: "full" as const, browsable, catalog_total: total };
  }
  return {
    scope: "browsable_subset" as const,
    browsable,
    catalog_total: total,
    scope_note:
      `This endpoint covers the ${browsable.toLocaleString()} endpoints bundled ` +
      `into the deployment, not the full ${total.toLocaleString()}. ` +
      `Use /api/stats for whole-catalog totals.`,
  };
}
