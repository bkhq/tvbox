/**
 * Minimal java.time stand-ins for live data: zone offsets (Live.getZoneId),
 * wall-clock conversion and the few DateTimeFormatter patterns the live
 * parsers use. An empty or unknown zone falls back to the device zone, like
 * ZoneId.systemDefault().
 */

const FIXED_OFFSET = /^(?:GMT|UTC|UT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i;
const UTC_NAMES = new Set(['Z', 'UTC', 'GMT', 'UT', 'Etc/UTC', 'Etc/GMT']);

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    let formatter: Intl.DateTimeFormat | null = null;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      formatter = null;
    }
    formatters.set(zone, formatter);
  }
  return formatters.get(zone) ?? null;
}

/** Offset of `zone` from UTC at `epochMs`, in milliseconds. */
export function zoneOffsetMs(zone: string, epochMs: number): number {
  const name = zone.trim();
  if (UTC_NAMES.has(name)) return 0;
  const fixed = FIXED_OFFSET.exec(name);
  if (fixed) {
    const minutes = Number(fixed[2]) * 60 + Number(fixed[3] ?? 0);
    return (fixed[1] === '-' ? -minutes : minutes) * 60_000;
  }
  const formatter = name ? zoneFormatter(name) : null;
  if (!formatter) return -new Date(epochMs).getTimezoneOffset() * 60_000;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) parts[part.type] = Number(part.value);
  const wall = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wall - (epochMs - (((epochMs % 1000) + 1000) % 1000));
}

/** LocalDateTime.atZone(zone).toInstant(): wall-clock fields to epoch milliseconds. */
export function wallToEpoch(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = wall - zoneOffsetMs(zone, wall);
  return wall - zoneOffsetMs(zone, guess);
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * Formats an instant in `zone` with a DateTimeFormatter-like pattern.
 * Supports y, M, d, H, m, s and S runs plus quoted literals.
 */
export function formatInZone(epochMs: number, pattern: string, zone: string): string {
  const date = new Date(epochMs + zoneOffsetMs(zone, epochMs));
  const fields: Record<string, number> = {
    y: date.getUTCFullYear(),
    M: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    H: date.getUTCHours(),
    m: date.getUTCMinutes(),
    s: date.getUTCSeconds(),
    S: date.getUTCMilliseconds(),
  };
  return pattern.replace(/'([^']*)'|([yMdHmsS])\2*/g, (run, literal: string | undefined, letter: string | undefined) => {
    if (literal !== undefined) return literal === '' ? "'" : literal;
    const value = fields[letter!]!;
    if (letter === 'y' && run.length === 2) return pad(value % 100);
    if (letter === 'S') return pad(value, 3).slice(0, run.length);
    return pad(value, run.length);
  });
}

/** LocalDate.now(zone).plusDays(offset) formatted as yyyy-MM-dd. */
export function dateInZone(epochMs: number, zone: string, offsetDays = 0): string {
  const date = new Date(epochMs + zoneOffsetMs(zone, epochMs));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
