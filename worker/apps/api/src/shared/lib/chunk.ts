/**
 * Split `items` into groups small enough for one statement's bound
 * parameters. Durable Object SQLite allows 100 per statement (libsql far
 * more), so any `IN (…)` built from a caller-sized list goes through this.
 */
export function chunked<T>(items: readonly T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
