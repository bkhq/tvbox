#!/usr/bin/env bun
/**
 * Fill the media library with TMDB's best-rated movies and series.
 *
 * Picks the top `--movies` and `--series` by rating (`/discover`, sorted by
 * vote average above a vote-count floor), fetches each title's details with
 * translations, credits, images and external ids, and writes them through
 * the console's bulk import route, worst-rated first so the best end up at
 * the top of the "latest" order. Re-running updates what changed and never
 * duplicates. `--public` makes the imported titles visible to every client.
 *
 * Usage:
 *   TVBOX_URL=https://tv.bk.io/mg TVBOX_API_TOKEN=… TMDB_TOKEN=… \
 *     bun scripts/media-import-tmdb.ts [--movies 2500] [--series 2500] [--min-votes 300,150]
 *       [--locales zh-CN,en-US] [--cast 10] [--batch 50] [--concurrency 8]
 *       [--public] [--dry-run] [--json report.json]
 *
 * TVBOX_URL is the console's base URL (origin plus BASE_PATH); the token is
 * an API token with the `media:write` scope. TMDB_TOKEN is a v3 API key or
 * a v4 read access token. `--dry-run` only talks to TMDB and validates the
 * mapped titles; `--json` writes the run's report.
 */
/* eslint-disable no-console */
import type { ImportResult, ImportTitle } from "../apps/api/src/modules/media/import/contract";
import type { Kind, Mapped, TmdbMovie, TmdbTv } from "./lib/tmdb";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { importTitleSchema } from "../apps/api/src/modules/media/import/contract";
import { DEFAULT_FALLBACK, DEFAULT_LOCALES, detail, mapMovie, mapTv, pool, rankedIds, tmdbClient } from "./lib/tmdb";

const LANGUAGE = "zh-CN";
// TV genres that are not programmes to watch: news, talk.
const TV_WITHOUT_GENRES = [10763, 10767];

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at === -1 || args[at + 1] === undefined
    ? fallback
    : args[at + 1]!;
}
function int(name: string, fallback: number): number {
  const n = Number(flag(name, String(fallback)));
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

const counts: Record<Kind, number> = {
  movie: int("movies", 2500),
  tv: int("series", 2500),
};
const [movieVotes = 300, tvVotes = 150] = flag("min-votes", "300,150").split(",").map(Number);
const minVotes: Record<Kind, number> = { movie: movieVotes, tv: tvVotes };
const locales = flag("locales", DEFAULT_LOCALES.join(",")).split(",").map(s => s.trim()).filter(Boolean);
const cast = int("cast", 10);
const batchSize = Math.max(1, Math.min(50, int("batch", 50)));
const concurrency = Math.max(1, int("concurrency", 8));
const dryRun = args.includes("--dry-run");
const makePublic = args.includes("--public");
const jsonFile = args.includes("--json")
  ? flag("json", "")
  : "";

const tmdbToken = process.env.TMDB_TOKEN;
const base = process.env.TVBOX_URL?.replace(/\/+$/, "");
const apiToken = process.env.TVBOX_API_TOKEN;
if (!tmdbToken) {
  console.error("TMDB_TOKEN must be set");
  process.exit(1);
}
if (!dryRun && (!base || !apiToken)) {
  console.error("TVBOX_URL and TVBOX_API_TOKEN must be set (or pass --dry-run)");
  process.exit(1);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: T }).data;
}

interface Report {
  readonly options: { counts: Record<Kind, number>; minVotes: Record<Kind, number>; locales: string[]; cast: number; dryRun: boolean };
  readonly listed: Record<Kind, number>;
  readonly actions: Record<ImportResult["action"], number>;
  /** How many titles took their display title / overview from each locale (or the original, or nothing). */
  readonly resolved: { title: Record<string, number>; overview: Record<string, number> };
  readonly failed: { kind: Kind; id: number; error: string }[];
  readonly invalid: { kind: Kind; id: number; error: string }[];
}

const report: Report = {
  options: {
    counts,
    minVotes,
    locales,
    cast,
    dryRun,
  },
  listed: { movie: 0, tv: 0 },
  actions: {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  },
  resolved: { title: {}, overview: {} },
  failed: [],
  invalid: [],
};
function bump(table: Record<string, number>, key: string) {
  table[key] = (table[key] ?? 0) + 1;
}

// TMDB_BASE_URL points the run at a stand-in server when testing the script itself.
const tmdb = tmdbClient(tmdbToken, undefined, undefined, process.env.TMDB_BASE_URL);
const mapOptions = { locales, fallback: DEFAULT_FALLBACK, cast };

async function send(titles: ImportTitle[]): Promise<void> {
  if (titles.length === 0)
    return;
  if (dryRun) {
    report.actions.unchanged += titles.length;
    return;
  }
  const { results } = await api<{ results: ImportResult[] }>("POST", "/media/import", {
    titles: makePublic
      ? titles.map(t => ({ ...t, public: true }))
      : titles,
  });
  for (const r of results)
    report.actions[r.action]++;
}

async function importKind(kind: Kind): Promise<void> {
  if (counts[kind] === 0)
    return;
  const ranked = await rankedIds(tmdb, kind, {
    count: counts[kind],
    minVotes: minVotes[kind],
    language: LANGUAGE,
    withoutGenres: kind === "tv"
      ? TV_WITHOUT_GENRES
      : undefined,
  }, (page, pages) => console.log(`${kind}: listed page ${page} of ${pages}`));
  report.listed[kind] = ranked.length;
  console.log(`${kind}: ${ranked.length} titles, importing worst-rated first`);

  let batch: ImportTitle[] = [];
  let done = 0;
  for (let start = 0; start < ranked.length; start += batchSize) {
    const slice = ranked.slice(start, start + batchSize);
    const mapped = await pool(slice, concurrency, async ({ id, rank }): Promise<Mapped | null> => {
      try {
        const data = await detail<TmdbMovie | TmdbTv>(tmdb, kind, id, LANGUAGE);
        return kind === "movie"
          ? mapMovie(data as TmdbMovie, { ...mapOptions, rank })
          : mapTv(data as TmdbTv, { ...mapOptions, rank });
      }
      catch (err) {
        report.failed.push({
          kind,
          id,
          error: err instanceof Error
            ? err.message
            : String(err),
        });
        return null;
      }
    });
    for (const [i, m] of mapped.entries()) {
      if (!m)
        continue;
      const parsed = importTitleSchema.safeParse(m.title);
      if (!parsed.success) {
        report.invalid.push({
          kind,
          id: slice[i]!.id,
          error: parsed.error.issues.map(x => `${x.path.join(".")}: ${x.message}`).join("; "),
        });
        continue;
      }
      bump(report.resolved.title, m.resolved.title ?? "none");
      bump(report.resolved.overview, m.resolved.overview ?? "none");
      batch.push(parsed.data);
    }
    try {
      await send(batch);
    }
    catch (err) {
      for (const t of batch) {
        report.failed.push({
          kind,
          id: Number(t.externalIds.tmdb.split(":")[1]),
          error: err instanceof Error
            ? err.message
            : String(err),
        });
      }
    }
    done += slice.length;
    console.log(`${kind}: ${done}/${ranked.length} (rank ${slice.at(-1)!.rank}–${slice[0]!.rank})`);
    batch = [];
  }
}

for (const kind of ["tv", "movie"] as const)
  await importKind(kind);

const a = report.actions;
console.log(`\nlisted: movies ${report.listed.movie}, series ${report.listed.tv}`);
console.log(dryRun
  ? `mapped: ${a.unchanged}`
  : `created ${a.created}  updated ${a.updated}  unchanged ${a.unchanged}  skipped ${a.skipped}`);
console.log(`display title from: ${Object.entries(report.resolved.title).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`overview from: ${Object.entries(report.resolved.overview).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (report.invalid.length > 0)
  console.log(`invalid (not sent): ${report.invalid.length}, e.g. ${report.invalid[0]!.kind} ${report.invalid[0]!.id}: ${report.invalid[0]!.error}`);
if (report.failed.length > 0)
  console.log(`failed: ${report.failed.length}, e.g. ${report.failed[0]!.kind} ${report.failed[0]!.id}: ${report.failed[0]!.error}`);
if (jsonFile)
  writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
process.exit(report.failed.length > 0 || report.invalid.length > 0
  ? 1
  : 0);
