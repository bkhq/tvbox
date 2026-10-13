/**
 * The slice of a D1 database the read model needs. A `D1Database` binding
 * satisfies it; tests pass an adapter over bun:sqlite (`sqlite-adapter.ts`).
 */
export interface RmStatement {
  bind: (...values: unknown[]) => RmStatement;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

export interface ReadModelDb {
  prepare: (sql: string) => RmStatement;
  /** Runs the statements in one transaction. */
  batch: (statements: RmStatement[]) => Promise<unknown[]>;
}

let current: ReadModelDb | null = null;

/** Installed at boot from the `MEDIA` binding; absent where there is none (publishing then skips the read model). */
export function setReadModelDb(db: ReadModelDb | null): void {
  current = db;
}

export function getReadModelDb(): ReadModelDb | null {
  return current;
}
