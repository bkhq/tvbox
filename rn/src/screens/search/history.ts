export const HISTORY_LIMIT = 20;

// Session-only: kept in memory, gone when the app restarts.
let keywords: string[] = [];

export function getHistory(): string[] {
  return keywords;
}

/** Moves `keyword` to the front, keeping the latest HISTORY_LIMIT entries. */
export function addHistory(keyword: string): string[] {
  keywords = [keyword, ...keywords.filter((item) => item !== keyword)].slice(0, HISTORY_LIMIT);
  return keywords;
}

export function clearHistory(): void {
  keywords = [];
}
