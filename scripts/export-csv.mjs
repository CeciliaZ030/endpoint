// Export data/stats/*.json snapshots as CSVs.
//
// Usage:
//   node scripts/export-csv.mjs                 # the latest 7 dated snapshots
//   node scripts/export-csv.mjs 2026-09-28       # from that date to the newest
//   node scripts/export-csv.mjs 2026-09-28 2026-10-04
//
// Writes into exports/<from>_<to>/. Nothing here touches data/.
//
// A note that matters for anyone reading the output: snapshots dated
// 2026-09-22 and later are counted from the FULL catalog; earlier ones were
// counted from a 20,000-endpoint subset, so the two are not comparable. And
// 2026-10-01..03 are missing on purpose — the fetch was broken those days and
// the guard refused to record a wrong number rather than write one.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STATS_DIR = "data/stats";
const FULL_CATALOG_FROM = "2026-09-22";

/** RFC 4180: quote when the value holds a comma, quote, newline or edge space. */
function cell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

function snapshots() {
  return readdirSync(STATS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

// Union of keys across the window, ordered by the newest snapshot's counts so
// the widest columns come first and a key that only exists on some days still
// gets a column (blank, not 0 — a missing breakdown is not a zero).
function unionKeys(snaps, field) {
  const seen = new Set();
  for (const s of snaps) for (const k of Object.keys(s[field] ?? {})) seen.add(k);
  const last = snaps[snaps.length - 1]?.[field] ?? {};
  return [...seen].sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0) || a.localeCompare(b));
}

const args = process.argv.slice(2);
const all = snapshots();
if (all.length === 0) throw new Error(`no snapshots in ${STATS_DIR}`);

let dates;
if (args.length === 0) dates = all.slice(-7);
else if (args.length === 1) dates = all.filter((d) => d >= args[0]);
else dates = all.filter((d) => d >= args[0] && d <= args[1]);
if (dates.length === 0) throw new Error(`no snapshots in range ${args.join("..")}`);

const snaps = dates.map((d) =>
  JSON.parse(readFileSync(join(STATS_DIR, `${d}.json`), "utf8")),
);
const from = dates[0];
const to = dates[dates.length - 1];
const outDir = join("exports", `${from}_${to}`);
mkdirSync(outDir, { recursive: true });

const write = (name, rows) => {
  const path = join(outDir, name);
  writeFileSync(path, csv(rows), "utf8");
  console.log(`${path} — ${rows.length - 1} row(s)`);
};

// ── 1. daily summary — one row per day, wide ────────────────────────────────
const catKeys = unionKeys(snaps, "byCategory");
const chainKeys = unionKeys(snaps, "byChain");
const srcKeys = unionKeys(snaps, "bySource");
const tierKeys = unionKeys(snaps, "byPriceTier");

const at = (obj, k) => (obj && k in obj ? obj[k] : "");

write("daily_summary.csv", [
  [
    "date",
    "total",
    "hosts",
    "catalog_scope",
    ...catKeys.map((k) => `category_${k}`),
    ...chainKeys.map((k) => `chain_${k}`),
    ...srcKeys.map((k) => `source_${k}`),
    ...tierKeys.map((k) => `price_${k}`),
  ],
  ...snaps.map((s) => [
    s.date,
    s.total,
    s.hostCount ?? "",
    s.date >= FULL_CATALOG_FROM ? "full" : "subset(20000)",
    ...catKeys.map((k) => at(s.byCategory, k)),
    ...chainKeys.map((k) => at(s.byChain, k)),
    ...srcKeys.map((k) => at(s.bySource, k)),
    ...tierKeys.map((k) => at(s.byPriceTier, k)),
  ]),
]);

// ── 2. long format — one row per date/dimension/key ─────────────────────────
const longRows = [];
for (const s of snaps) {
  for (const [dim, field] of [
    ["category", "byCategory"],
    ["chain", "byChain"],
    ["source", "bySource"],
    ["price_tier", "byPriceTier"],
  ]) {
    for (const [k, v] of Object.entries(s[field] ?? {})) {
      longRows.push([s.date, dim, k, v, s.total, (v / s.total).toFixed(6)]);
    }
  }
}
write("breakdowns_long.csv", [
  ["date", "dimension", "key", "count", "day_total", "share"],
  ...longRows,
]);

// ── 3. top hosts, long — byHost holds the top 100 per snapshot ──────────────
const hostRows = [];
for (const s of snaps) {
  (s.byHost ?? []).forEach((h, i) => {
    hostRows.push([
      s.date,
      i + 1,
      h.host,
      h.name ?? "",
      h.count,
      h.priceMedian ?? "",
      h.topCategory ?? "",
    ]);
  });
}
write("top_hosts_long.csv", [
  ["date", "rank", "host", "name", "endpoints", "price_median_usdc", "top_category"],
  ...hostRows,
]);

// ── 4. most-called, long — rankTop50, trimmed to the top 10 per day ─────────
const TOP_N = 10;
const rankRows = [];
for (const s of snaps) {
  for (const r of (s.rankTop50 ?? []).slice(0, TOP_N)) {
    rankRows.push([
      s.date,
      r.rank,
      r.host ?? "",
      r.title ?? "",
      r.origin ?? "",
      r.tx_count ?? "",
      r.total_amount ?? "",
      r.unique_buyers ?? "",
      r.popularity_metric ?? "",
    ]);
  }
}
write(`most_called_top${TOP_N}_long.csv`, [
  [
    "date",
    "rank",
    "host",
    "title",
    "origin",
    "tx_count",
    "total_amount_usdc",
    "unique_buyers",
    "metric",
  ],
  ...rankRows,
]);

// ── 5. the window's own trend ───────────────────────────────────────────────
const first = snaps[0];
const last = snaps[snaps.length - 1];
const span = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000;
const delta = last.total - first.total;
const trend = [
  ["metric", "value"],
  ["from", first.date],
  ["to", last.date],
  ["snapshots_present", snaps.length],
  ["calendar_days_spanned", span + 1],
  ["missing_days", span + 1 - snaps.length],
  ["total_first", first.total],
  ["total_last", last.total],
  ["total_delta", delta],
  ["total_growth_pct", ((delta / first.total) * 100).toFixed(2)],
  ["per_day_avg", span > 0 ? Math.round(delta / span) : ""],
  ["hosts_first", first.hostCount ?? ""],
  ["hosts_last", last.hostCount ?? ""],
  ["hosts_delta", (last.hostCount ?? 0) - (first.hostCount ?? 0)],
];
write("trend.csv", trend);

// ── README ─────────────────────────────────────────────────────────────────
const missing = [];
for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
  const d = new Date(t).toISOString().slice(0, 10);
  if (!dates.includes(d)) missing.push(d);
}

writeFileSync(
  join(outDir, "README.md"),
  `# x402 Endpoint — ${from} 〜 ${to}

出力日時: ${new Date().toISOString()}
元データ: \`data/stats/*.json\`（日次スナップショット）

## ファイル

| ファイル | 内容 |
| --- | --- |
| \`daily_summary.csv\` | 1日1行。総数・ホスト数・カテゴリ・チェーン・ソース・価格帯 |
| \`breakdowns_long.csv\` | 日付 × 軸 × キーの縦持ち。\`share\` は当日総数に対する比率 |
| \`top_hosts_long.csv\` | 各日の上位100ホスト（件数・価格中央値・主カテゴリ） |
| \`most_called_top10_long.csv\` | 各日の呼び出し数トップ10（tx_count・金額・ユニーク購入者） |
| \`trend.csv\` | 期間の増減まとめ |

## 期間の数字

- **${first.date}: ${first.total.toLocaleString()} 件 / ${(first.hostCount ?? 0).toLocaleString()} ホスト**
- **${last.date}: ${last.total.toLocaleString()} 件 / ${(last.hostCount ?? 0).toLocaleString()} ホスト**
- 増減: **${delta >= 0 ? "+" : ""}${delta.toLocaleString()} 件（${((delta / first.total) * 100).toFixed(2)}%）**${span > 0 ? ` · 1日あたり約 ${Math.round(delta / span).toLocaleString()} 件` : ""}

## 読むときの注意

**1. 9月21日以前と9月22日以降は直接比較できません。**
9月22日以降のスナップショットは全件カタログから集計しています。それ以前は20,000件のサブセットからの集計でした。\`daily_summary.csv\` の \`catalog_scope\` 列で区別できます。

**2. 欠測日があります。**
${
  missing.length === 0
    ? "この期間に欠測はありません。"
    : `この期間の欠測: ${missing.join(", ")}

10月1〜3日は取得が壊れていた日です。原因は \`endpoints.push(...items)\` の引数展開がスタック上限（実測 125,259件）を越えたことで、クロールは完走していたのに結果が全部捨てられていました。ガードが「間違った数字を書くより記録しない」を選んだため、これらの日は意図的に空です。後から再構成はできません。`
}

**3. 総数は「x402scan に載っている数」です。**
${last.date} 時点で x402scan 自身の申告（\`api_total\`）は 135,036 でした。カタログの ${last.total.toLocaleString()} との差は、重複除去（同一URLが複数メソッドで登録されているもの）によるものです。

**4. ソースはほぼ x402scan 単独です。**
${Object.entries(last.bySource ?? {})
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
  .join(" · ")}
`,
  "utf8",
);
console.log(`${join(outDir, "README.md")}`);
console.log(`\n→ ${outDir}`);
