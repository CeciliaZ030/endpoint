import Link from "next/link";
import { getRank } from "@/lib/rank";
import { getHosts, hostStats } from "@/lib/hosts";
import { liveTotals, liveProviders } from "@/lib/live-catalog";
import { getCatalog } from "@/lib/data";
import {
  formatProviderPrice,
  getProviders,
  type ProviderRow,
} from "@/lib/providers";
import {
  CATEGORY_LABELS,
  DIRECTORY_META,
  DIRECTORY_SOURCES,
  type Category,
} from "@/lib/types";
import { SITE_URL } from "@/lib/site";

// All former standalone pages, inlined as sections of the single top page.

function usd(n: number): string {
  return n >= 1
    ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`;
}


/* ---------------- Named providers (above the ranking) ---------------- */

// One row of the two provider tables. `rank` is display order only.
function ProviderRowView({ row, rank }: { row: ProviderRow; rank: number }) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-4 border-b border-border px-3 py-2 text-sm md:grid-cols-[2.5rem_minmax(0,2.4fr)_5rem_6rem_minmax(0,1fr)]">
      <span className="tabular-nums text-muted">{rank}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {row.brand ?? (row.name || row.host)}
        </span>
        <a
          href={`https://${row.host}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-xs text-muted hover:text-accent"
        >
          {row.host}
        </a>
      </span>
      <span className="text-right tabular-nums">
        {row.count.toLocaleString()}
      </span>
      <span className="hidden text-right tabular-nums text-muted md:block">
        {formatProviderPrice(row)}
      </span>
      <span className="hidden text-[11px] uppercase tracking-wide text-muted md:block">
        {row.topCategory ? CATEGORY_LABELS[row.topCategory] : "—"}
      </span>
    </div>
  );
}

function ProviderTable({
  caption,
  rows,
}: {
  caption: React.ReactNode;
  rows: ProviderRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{caption}</p>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="hidden grid-cols-[2.5rem_minmax(0,2.4fr)_5rem_6rem_minmax(0,1fr)] gap-x-4 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted md:grid">
          <span>#</span>
          <span>Provider</span>
          <span className="text-right">Endpoints</span>
          <span className="text-right">Median price</span>
          <span>Top category</span>
        </div>
        {rows.map((r, i) => (
          <ProviderRowView key={r.host} row={r} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

export async function NamedProvidersSection() {
  const p = await liveProviders();
  const firstParty = p.firstParty;
  const selfHosted = p.selfHosted;
  const brands = new Set(firstParty.map((r) => r.brand)).size;

  return (
    <section id="providers" className="scroll-mt-6 space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Who serves x402 under their own name
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Anyone can publish an endpoint titled &ldquo;CoinGecko Price
          API&rdquo; on their own domain, and this catalog lists it as
          faithfully as the real one. So a provider is listed here only when the
          host sits under a{" "}
          <span className="text-black">domain that company controls</span>.
          Endpoints served through a gateway operator that resells someone
          else&apos;s API, or from shared hosting, are deliberately excluded —
          whatever the listing calls itself.
        </p>
      </header>

      {p.status !== "ok" || firstParty.length + selfHosted.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Provider list is{" "}
          <span className="font-medium text-black">unavailable</span> — the
          artifact could not be built from the catalog. We show{" "}
          <span className="font-medium text-black">no substitute list</span>.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:grid-cols-4">
            <Stat label="recognizable companies" value={brands} />
            <Stat label="their hosts" value={firstParty.length} />
            <Stat label="other named providers" value={selfHosted.length} />
            <Stat
              label="endpoints scanned"
              value={p.scanned.toLocaleString()}
            />
          </div>

          <ProviderTable
            caption={
              <>
                <span className="font-medium text-black">
                  Companies you already know
                </span>{" "}
                — serving x402 from their own domain.
              </>
            }
            rows={firstParty}
          />

          <ProviderTable
            caption={
              <>
                <span className="font-medium text-black">
                  Other providers on their own domain
                </span>{" "}
                — listed in the Solana Foundation pay-skills catalog and served
                directly, not through a gateway.
              </>
            }
            rows={selfHosted}
          />

          <p className="text-[11px] text-muted">
            Counted from {p.scanned.toLocaleString()} endpoints in{" "}
            <code>{p.source}</code>
            {p.subset ? (
              <>
                {" "}
                — a <span className="text-black">capped subset</span>, so these
                counts understate
              </>
            ) : null}
            . A company appearing here means it serves x402 from its own domain;
            it does not imply any relationship with x402 Inc.
          </p>
        </>
      )}
    </section>
  );
}

/* ---------------- Most-called endpoints (was /rank) ---------------- */
export function MostCalledSection() {
  const rank = getRank(50);
  return (
    <section id="most-called" className="scroll-mt-6 space-y-4">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Most-called endpoints
        </h2>
        <p className="max-w-2xl text-sm text-muted">
          Numbers are x402scan&apos;s — re-listed here as-is, sorted by{" "}
          <span className="text-black">{rank.sorting}</span> over the last{" "}
          <span className="text-black">{rank.timeframe}d</span>. We do not
          re-measure, reorder, or boost our own endpoints (
          <a href="#about" className="text-accent hover:underline">
            about
          </a>
          ).
        </p>
      </header>

      {rank.status !== "ok" ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-muted">
            Ranking is{" "}
            <span className="font-medium text-black">unavailable</span> — the
            x402scan ranking couldn&apos;t be fetched. We show{" "}
            <span className="font-medium text-black">no substitute order</span>{" "}
            (not catalog, name, route-count, or price order). Meanwhile, see{" "}
            <a href="#hosts" className="text-accent hover:underline">
              where routes concentrate by host
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="hidden grid-cols-[2.5rem_minmax(0,2.2fr)_6rem_7rem_5.5rem_5rem] gap-x-4 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted md:grid">
            <span>#</span>
            <span>Service</span>
            <span className="text-right">Calls (tx)</span>
            <span className="text-right">USDC settled</span>
            <span className="text-right">Buyers</span>
            <span>Category</span>
          </div>
          <div className="max-h-[48rem] overflow-y-auto">
          {rank.rows.map((r) => (
            <div
              key={r.origin}
              className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-4 border-b border-border px-3 py-2 text-sm md:grid-cols-[2.5rem_minmax(0,2.2fr)_6rem_7rem_5.5rem_5rem]"
            >
              <span className="tabular-nums text-muted">{r.rank}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {r.host}
                  {r.price ? ` · ${r.price.amount} ${r.price.currency}` : ""}
                  {r.networks.length ? ` · ${r.networks.join(", ")}` : ""}
                </span>
              </span>
              <span className="text-right tabular-nums md:col-auto">
                {r.tx_count.toLocaleString()}
              </span>
              <span className="hidden text-right tabular-nums md:block">
                {usd(r.total_amount)}
              </span>
              <span className="hidden text-right tabular-nums md:block">
                {r.unique_buyers.toLocaleString()}
              </span>
              <span className="hidden text-[11px] uppercase tracking-wide text-muted md:block">
                {r.category ? CATEGORY_LABELS[r.category] : "—"}
              </span>
            </div>
          ))}
          </div>
          <div className="px-3 py-2 text-[11px] text-muted">
            Source of the numbers: x402scan ({rank.metric}). Re-listed, not
            re-measured. Fetched {rank.generated_at.slice(0, 10)}.
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Hosts (was /hosts) ---------------- */
const TOP_N = 100;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export async function HostsSection() {
  // The same per-request snapshot the hero uses. It is counted from the FULL
  // catalog, while this page bundles only the capped subset — and it has to be
  // the SAME read, or the host figures contradict the endpoint total shown
  // directly above them whenever the build is older than the repository.
  const snap = (await liveTotals()).snapshot;
  const fromSnapshot = Boolean(snap?.byHost?.length && snap?.hostCount);

  const local = hostStats();
  const s = fromSnapshot
    ? {
        hostCount: snap!.hostCount!,
        totalRoutes: snap!.total,
        routesPerHostMedian: local.routesPerHostMedian,
        singleRouteHosts: local.singleRouteHosts,
      }
    : local;

  const hosts = fromSnapshot
    ? snap!.byHost!.map((h) => ({
        host: h.host,
        serviceName: h.name,
        count: h.count,
        share: snap!.total ? h.count / snap!.total : 0,
        priceMedian: h.priceMedian,
        topCategory: (h.topCategory ?? null) as Category | null,
      }))
    : getHosts();
  const shown = hosts.slice(0, TOP_N);
  const hidden = fromSnapshot ? s.hostCount - shown.length : hosts.length - shown.length;

  return (
    <section id="hosts" className="scroll-mt-6 space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Hosts</h2>
        <p className="max-w-3xl text-sm text-muted">
          A host&apos;s route count reflects the{" "}
          <span className="text-black">granularity of its route expansion</span>
          , not the operator&apos;s size: the top hosts are each a single
          service that turns one dataset or wrapper into hundreds–thousands of
          per-query routes. So {s.totalRoutes.toLocaleString()} routes come from
          only {s.hostCount.toLocaleString()} hosts.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:grid-cols-4">
        <Stat label="routes" value={s.totalRoutes.toLocaleString()} />
        <Stat label="hosts" value={s.hostCount.toLocaleString()} />
        <Stat
          label={
            fromSnapshot ? "median routes / host (browsable)" : "median routes / host"
          }
          value={s.routesPerHostMedian ?? "—"}
        />
        <Stat
          label={
            fromSnapshot ? "hosts with 1 route (browsable)" : "hosts with 1 route"
          }
          value={s.singleRouteHosts.toLocaleString()}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="hidden grid-cols-[2.5rem_minmax(0,2.4fr)_5rem_4rem_6rem_minmax(0,1fr)] gap-x-4 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted md:grid">
          <span>#</span>
          <span>Service</span>
          <span className="text-right">Routes</span>
          <span className="text-right">Share</span>
          <span className="text-right">Median price</span>
          <span>Top category</span>
        </div>
        <div className="max-h-[48rem] overflow-y-auto">
        {shown.map((h, i) => (
          <div
            key={h.host}
            id={h.host}
            className="grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-4 border-b border-border px-3 py-2 text-sm scroll-mt-20 md:grid-cols-[2.5rem_minmax(0,2.4fr)_5rem_4rem_6rem_minmax(0,1fr)]"
          >
            <span className="tabular-nums text-muted">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{h.serviceName}</span>
              <a
                href={`https://${h.host}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-muted hover:text-accent"
              >
                {h.host}
              </a>
            </span>
            <span className="text-right tabular-nums">
              {h.count.toLocaleString()}
            </span>
            <span className="hidden text-right tabular-nums text-muted md:block">
              {(h.share * 100).toFixed(1)}%
            </span>
            <span className="hidden text-right tabular-nums text-muted md:block">
              {h.priceMedian == null ? "—" : `${h.priceMedian} USDC`}
            </span>
            <span className="hidden text-[11px] uppercase tracking-wide text-muted md:block">
              {h.topCategory ? CATEGORY_LABELS[h.topCategory] : "—"}
            </span>
          </div>
        ))}
        </div>
        {hidden > 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted">
            Showing the top {shown.length} of {s.hostCount.toLocaleString()}{" "}
            hosts. The rest are in{" "}
            <Link href="/api/hosts" className="text-accent hover:underline">
              /api/hosts
            </Link>
            .
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------- About (was /about) ---------------- */
export function AboutSection() {
  const { generated_at, endpoints } = getCatalog();
  return (
    <section id="about" className="scroll-mt-6 max-w-2xl space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">About</h2>

      <div className="space-y-3 text-sm text-muted">
        <p className="text-black">
          x402 Endpoint is a cross-directory unified catalog of x402 ecosystem
          endpoints. The x402 ecosystem has several community-maintained
          directories running in parallel — this site brings them into one place
          so you don&apos;t have to check each one individually.
        </p>
        <p>
          Currently tracking{" "}
          <span className="text-black">{endpoints.length}</span> endpoints, last
          updated{" "}
          <span className="text-black">
            {new Date(generated_at).toISOString().slice(0, 10)}
          </span>
          .
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-medium">Data sources</h3>
        <ul className="space-y-1 text-sm">
          {DIRECTORY_SOURCES.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <Link
                href={`/directory/${s}`}
                className="text-accent hover:underline"
              >
                {DIRECTORY_META[s].label}
              </Link>
              <a
                href={DIRECTORY_META[s].home}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-black text-xs"
              >
                {DIRECTORY_META[s].home} ↗
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 text-sm text-muted">
        <h3 className="text-lg font-medium text-black">Update frequency</h3>
        <p>
          A daily GitHub Actions job fetches each directory, rebuilds the unified{" "}
          <code>data/endpoints.json</code>, and commits it. Vercel redeploys on
          push and pages revalidate once per day (ISR).
        </p>
      </div>

      <div className="space-y-2 text-sm text-muted">
        <h3 className="text-lg font-medium text-black">Built by x402 Inc.</h3>
        <p>
          This catalog is built by{" "}
          <a className="text-accent hover:underline" href="https://x402jp.com">
            x402 Inc.
          </a>
          , which also ships its own x402 endpoints (onchain data, intelligence,
          oracle, and compliance APIs). Those endpoints are contributed to this
          catalog under the{" "}
          <Link className="text-accent hover:underline" href="/by/x402-inc">
            x402 Inc.
          </Link>{" "}
          source, alongside the community directories.
        </p>
        <p>
          As the operator, x402 Inc. features its own endpoints: they are
          highlighted and pinned to the top of listings. This is disclosed, not
          hidden. Everything else — the third-party directories — is aggregated
          on equal footing with no preferential ranking between them. If a
          third-party directory also lists one of x402 Inc.&apos;s URLs, the
          entry shows both sources. See more at{" "}
          <a className="text-accent hover:underline" href="https://note.com/x402inc">
            note.com/x402inc
          </a>
          .
        </p>
      </div>

      <div className="space-y-2 text-sm text-muted">
        <h3 className="text-lg font-medium text-black">Contributing</h3>
        <p>
          There is no sign-up or submission form. To add or correct an endpoint,
          open a pull request against{" "}
          <a
            className="text-accent hover:underline"
            href="https://github.com/kato9292929/endpoint"
          >
            the repository
          </a>
          .
        </p>
      </div>
    </section>
  );
}

/* ---------------- For Agents (was /for-agents) ---------------- */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-lg border border-border bg-surface p-4 text-xs overflow-x-auto">
      <code>{children}</code>
    </pre>
  );
}

function ApiEndpoint({
  method,
  path,
  desc,
}: {
  method: string;
  path: string;
  desc: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="font-mono text-[11px] rounded bg-black/[0.05] border border-border px-1.5 py-0.5 text-accent">
        {method}
      </span>
      <code className="font-mono">{path}</code>
      <span className="text-muted">— {desc}</span>
    </div>
  );
}

export function ForAgentsSection() {
  return (
    <section id="for-agents" className="scroll-mt-6 max-w-2xl space-y-8">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">For Agents</h2>
        <p className="text-muted text-sm">
          The whole catalog is available programmatically — no API key, no
          sign-up. Read it over REST, discover it via OpenAPI, or wire it into an
          agent with the MCP server.
        </p>
      </header>

      <div className="space-y-3">
        <h3 className="text-lg font-medium">REST API</h3>
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <ApiEndpoint method="GET" path="/api/endpoints" desc="all endpoints (filterable)" />
          <ApiEndpoint method="GET" path="/api/endpoints/:id" desc="one endpoint" />
          <ApiEndpoint method="GET" path="/api/search?q=" desc="fuzzy search" />
          <ApiEndpoint method="GET" path="/api/stats" desc="aggregate counts" />
          <ApiEndpoint method="GET" path="/api/openapi.json" desc="OpenAPI 3.1 spec" />
        </div>
        <p className="text-sm text-muted">
          Filters (AND-combined) on <code>/api/endpoints</code> and{" "}
          <code>/api/search</code>: <code>category</code>, <code>network</code>,{" "}
          <code>protocol</code>, <code>source</code>. Responses are CORS-open and
          cached at the edge for a day.
        </p>
        <Code>{`# all data endpoints on Base
curl "${SITE_URL}/api/endpoints?category=data&network=Base"

# search
curl "${SITE_URL}/api/search?q=stock"

# aggregate stats
curl "${SITE_URL}/api/stats"`}</Code>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-medium">MCP server</h3>
        <p className="text-sm text-muted">
          The <code>x402-endpoint-mcp</code> package exposes four tools —{" "}
          <code>list_endpoints</code>, <code>search_endpoints</code>,{" "}
          <code>get_endpoint</code>, <code>get_stats</code> — backed by this API.
        </p>
        <p className="text-sm text-muted">Claude Desktop / Cursor config:</p>
        <Code>{`{
  "mcpServers": {
    "x402-endpoint": {
      "command": "npx",
      "args": ["-y", "x402-endpoint-mcp"],
      "env": { "X402_ENDPOINT_API_BASE": "${SITE_URL}" }
    }
  }
}`}</Code>
        <p className="text-sm text-muted">
          See the{" "}
          <a
            className="text-accent hover:underline"
            href="https://github.com/kato9292929/endpoint/tree/main/mcp"
          >
            mcp/ package README
          </a>{" "}
          for ChatGPT and other clients.
        </p>
      </div>

      <div className="space-y-2 text-sm text-muted">
        <h3 className="text-lg font-medium text-black">Fair use</h3>
        <p>
          Free and unauthenticated. A light, best-effort per-IP rate limit
          protects the service; agents that respond to{" "}
          <code>429 / Retry-After</code> won&apos;t notice it. Please don&apos;t
          hammer the API — the full dataset is one request to{" "}
          <code>/api/endpoints</code>.
        </p>
      </div>
    </section>
  );
}
