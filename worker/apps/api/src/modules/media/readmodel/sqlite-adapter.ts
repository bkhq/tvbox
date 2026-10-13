import type { ReadModelDb, RmStatement } from "./store";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Tests only: a D1 stand-in over bun:sqlite, migrated from `d1/media/`.

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../d1/media");

type Value = string | number | bigint | boolean | null | Uint8Array;

class Statement implements RmStatement {
  constructor(private readonly db: Database, readonly sql: string, readonly params: Value[] = []) {}

  bind(...values: unknown[]): RmStatement {
    return new Statement(this.db, this.sql, values.map(v => (v === undefined ? null : v) as Value));
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.query(this.sql).all(...this.params) as T[] };
  }

  async first<T>(): Promise<T | null> {
    return (this.db.query(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async run(): Promise<unknown> {
    return this.db.query(this.sql).run(...this.params);
  }
}

export function createSqliteReadModel(): ReadModelDb & { close: () => void; statements: number } {
  const db = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort())
    db.run(readFileSync(join(MIGRATIONS, file), "utf8"));
  const adapter = {
    statements: 0,
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: RmStatement[]) => {
      adapter.statements += statements.length;
      return db.transaction(() => statements.map(s => db.query((s as Statement).sql).run(...(s as Statement).params)))();
    },
    close: () => db.close(),
  };
  return adapter;
}
