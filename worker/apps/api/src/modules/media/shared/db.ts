import type { AppDatabase } from "@/db";

/** The database or a transaction on it: what helpers that run inside either take. */
export type TxOrDb = AppDatabase | Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
