import { CatalogExplorer } from "@/components/CatalogExplorer";
import { StatsBar } from "@/components/StatsBar";
import { TotalSparkline } from "@/components/TotalSparkline";
import {
  NamedProvidersSection,
  MostCalledSection,
  HostsSection,
  AboutSection,
  ForAgentsSection,
} from "@/components/sections";
import { HeroVideo } from "@/components/hero/HeroVideo";
import { Hero } from "@/components/hero/Hero";
import {
  getBundledCount,
  getCatalog,
  getCategoryCounts,
  getNetworks,
  getProtocols,
  getSourceCounts,
} from "@/lib/data";
import { liveTotals } from "@/lib/live-catalog";

// Regenerate hourly. The headline figures come from a per-request fetch of
// the committed snapshot (@/lib/live-catalog), so a short window is what lets
// the daily commit reach the page without a deployment — which is the whole
// point: between 2026-10-07 and 2026-10-19 none was promoted and the hero sat
// at 131,675 while the catalog reached 161,826.
export const revalidate = 3600;

// Swap this to change the hero background (autoplaying, looping, muted).
const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260517_222138_3e3205be-3364-417b-a64a-bfe087acbec4.mp4";

export default async function HomePage() {
  const { endpoints } = getCatalog();
  // The catalog's real size, read from the repository rather than from this
  // build. `endpoints` is the capped subset the page bundles, so its length is
  // the browsable count, not the total.
  const live = await liveTotals();
  const totalEndpoints = live.total;
  const bundled = getBundledCount();
  const networks = getNetworks();
  const protocols = getProtocols();
  const categoryCounts = getCategoryCounts();
  const sourceCounts = getSourceCounts();

  const updated = new Date(live.date ?? live.generatedAt);
  const updatedLabel = isNaN(updated.getTime())
    ? "—"
    : updated.toISOString().slice(0, 10);

  // Prefer the snapshot's breakdowns (full catalog) over the bundled subset's.
  const snap = live.snapshot;
  const countNonZero = (o: Record<string, number> | undefined) =>
    o ? Object.values(o).filter((n) => n > 0).length : null;
  const nonEmptyCategories =
    countNonZero(snap?.byCategory) ??
    Object.values(categoryCounts).filter((c) => c > 0).length;
  const networkCount = countNonZero(snap?.byChain) ?? networks.length;
  const directoriesCount =
    countNonZero(snap?.bySource) ?? Object.keys(sourceCounts).length;

  const heroStats = [
    { value: totalEndpoints, label: "ENDPOINTS\nINDEXED", plus: true },
    { value: nonEmptyCategories, label: "CATEGORIES\nTRACKED" },
    { value: directoriesCount, label: "SOURCE\nDIRECTORIES" },
  ];

  return (
    <>
      <HeroVideo src={HERO_VIDEO} />

      {/* Break out of the layout's max-w-6xl / padding to go full-bleed. */}
      <div className="relative left-1/2 right-1/2 -mx-[50vw] -mt-8 -mb-8 w-screen">
        <Hero stats={heroStats} />

        {/* Everything on one page, on a solid background over the fixed video. */}
        <section id="catalog" className="relative z-[1] bg-bg">
          <div className="mx-auto max-w-6xl space-y-16 px-5 py-16 sm:px-8">
            <header>
              <h2 className="text-2xl font-semibold tracking-tight">
                The catalog — what&apos;s live, and where it&apos;s called
              </h2>
            </header>

            {/* Who serves x402 under their own name */}
            <NamedProvidersSection />

            {/* Most-called endpoints (x402scan ranking) */}
            <MostCalledSection />

            {/* Aggregate stats + trend */}
            <div className="space-y-3">
              <StatsBar
                total={totalEndpoints}
                browsable={bundled}
                networks={networkCount}
                categories={nonEmptyCategories}
                directories={directoriesCount}
                updated={updatedLabel}
              />
              <TotalSparkline />
            </div>

            {/* Hosts */}
            <HostsSection />

            {/* Search + filters + full list — the full catalog, just above About */}
            <CatalogExplorer
              endpoints={endpoints}
              networks={networks.map((n) => n.name)}
              protocols={protocols.map((p) => p.name)}
            />

            {/* About */}
            <AboutSection />

            {/* For Agents */}
            <ForAgentsSection />
          </div>
        </section>
      </div>
    </>
  );
}
