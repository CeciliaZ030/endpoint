// Whole-catalog figures read at request time, not baked in at build time.
//
// Why this exists: everything else the site serves is frozen when it is built.
// data/endpoints.json is an `import`, and data/stats/*.json ships as traced
// files inside the serverless function, whose filesystem is immutable. So the
// daily commit changed nothing the public could see until a deployment was
// promoted — and between 2026-10-07 and 2026-10-19 none was. The catalog grew
// 131,675 -> 161,826 while endpoint.x402jp.com kept answering 131,675.
//
// Fetching the daily snapshot over HTTP instead makes the numbers follow the
// commit rather than the deployment. The repository is public, so this needs
// no credentials, and a snapshot is a few KB — far cheaper than the 12.6MB
// catalog, and it already holds every whole-catalog figure the site shows
// (total, hosts, and the category/chain/source/price breakdowns, all computed
// from the full catalog rather than the bundled subset).
//
// This does NOT make search cover the full catalog; that still reads the
// bundled subset. See scopeMeta() in ./api.

import { latestSnapshot, type Snapshot } from "./stats-history";
import { getCatalog, getTotalEndpoints } from "./data";
import { getProviders, type ProvidersArtifact } from "./providers";

/** Raw host for the committed data. Override to point at a fork or a branch. */
const RAW_BASE =
  process.env.DATA_RAW_BASE ??
  "https://raw.githubusercontent.com/kato9292929/endpoint/main";

/** How long a fetched snapshot stays good. The fetch job runs once a day. */
const REVALIDATE_SECONDS = 3600;

/**
 * How many days back to look for the newest snapshot. The job can be late, and
 * the guard deliberately skips a day rather than record a wrong total, so
 * "yesterday is missing" is a normal state, not a fault.
 */
const LOOKBACK_DAYS = 10;

/** Per-request memo, so one render does not refetch for every component. */
let inflight: Promise<LiveTotals> | null = null;
let inflightAt = 0;

export type LiveTotals = {
  /** Endpoints in the whole catalog. */
  total: number;
  /** Distinct hosts in the whole catalog, when a snapshot supplied one. */
  hostCount: number | null;
  /** The date of the snapshot these came from (YYYY-MM-DD), when known. */
  date: string | null;
  /** Catalog `generated_at`, or the snapshot's own timestamp. */
  generatedAt: string;
  /**
   * Where the figures came from. "live" means fetched this request and so
   * current with the repository; "bundled" means the build's own copy, which
   * is what the stale-deployment problem looks like.
   */
  origin: "live" | "bundled";
  /** The whole snapshot, for breakdowns. */
  snapshot: Snapshot | null;
};

function utcDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function bundledTotals(): LiveTotals {
  const snap = latestSnapshot();
  const { generated_at } = getCatalog();
  return {
    total: snap?.total ?? getTotalEndpoints(),
    hostCount: snap?.hostCount ?? null,
    date: snap?.date ?? null,
    generatedAt: generated_at,
    origin: "bundled",
    snapshot: snap,
  };
}

async function fetchSnapshot(date: string): Promise<Snapshot | null> {
  try {
    const res = await fetch(`${RAW_BASE}/data/stats/${date}.json`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const snap = (await res.json()) as Snapshot;
    // A snapshot without a usable total is not a snapshot. Treat it as absent
    // rather than publishing a 0 or a NaN as the catalog's size.
    if (typeof snap?.total !== "number" || !Number.isFinite(snap.total)) {
      return null;
    }
    return snap;
  } catch {
    return null; // offline, blocked, rate-limited — fall back, never throw
  }
}

async function resolve(): Promise<LiveTotals> {
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const date = utcDaysAgo(i);
    const snap = await fetchSnapshot(date);
    if (!snap) continue;
    const bundled = latestSnapshot();
    // Never go backwards. If the build happens to carry something newer than
    // what we fetched (a snapshot committed after this build, then reverted,
    // say), keep the larger figure rather than announcing a shrink.
    if (bundled && bundled.date > (snap.date ?? date)) return bundledTotals();
    return {
      total: snap.total,
      hostCount: snap.hostCount ?? null,
      date: snap.date ?? date,
      generatedAt: snap.generatedAt ?? getCatalog().generated_at,
      origin: "live",
      snapshot: snap,
    };
  }
  return bundledTotals();
}

/**
 * Whole-catalog figures, fetched once per request and cached for an hour.
 *
 * Always resolves: if the fetch fails for any reason the build's own numbers
 * come back with `origin: "bundled"`, so a page renders stale rather than
 * broken.
 */
export function liveTotals(): Promise<LiveTotals> {
  // Collapse the calls a single render makes. The 5s window is well under a
  // render and well under the fetch cache's own lifetime.
  const now = Date.now();
  if (!inflight || now - inflightAt > 5_000) {
    inflightAt = now;
    inflight = resolve().catch(() => bundledTotals());
  }
  return inflight;
}

/**
 * The named-providers artifact, read from the repository rather than the
 * build.
 *
 * It has to travel with the snapshot: the section renders "N endpoints
 * scanned" right under the hero's endpoint total, so a bundled copy next to a
 * live total puts "161,826" and "Counted from 131,675 endpoints" on the same
 * screen. Small enough (a few dozen rows) that fetching it costs nothing.
 */
export async function liveProviders(): Promise<ProvidersArtifact> {
  try {
    const res = await fetch(`${RAW_BASE}/data/providers.json`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return getProviders();
    const raw = (await res.json()) as Partial<ProvidersArtifact>;
    if (typeof raw?.scanned !== "number") return getProviders();
    return {
      ...(getProviders() as ProvidersArtifact),
      ...raw,
      firstParty: raw.firstParty ?? [],
      selfHosted: raw.selfHosted ?? [],
    } as ProvidersArtifact;
  } catch {
    return getProviders();
  }
}
