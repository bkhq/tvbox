/** One SharedPreferences entry with its Java type; long and float values arrive as JS numbers. */
export type LegacyPref =
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'int' | 'long' | 'float'; value: number }
  | { type: 'set'; value: string[] };

export type LegacyPrefs = Record<string, LegacyPref>;

/** One table row as column -> value; INTEGER and REAL columns arrive as numbers, NULL and BLOB as null. */
export type LegacyRow = Record<string, string | number | null>;

/** Rows of the Room tables Config, History and Keep; empty when the database or table is missing. */
export interface LegacyDb {
  config: LegacyRow[];
  history: LegacyRow[];
  keep: LegacyRow[];
}

/** Read-only view of the Java app's data. */
export interface LegacyReader {
  readLegacyPrefs(): Promise<LegacyPrefs>;
  readLegacyDb(): Promise<LegacyDb>;
}
