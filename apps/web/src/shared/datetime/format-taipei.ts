// Fixed Asia/Taipei wall-clock formatting for provenance labels. Never rely
// on the browser locale: the demo must read identically on every machine.
// Taiwan has no DST, but Intl with an explicit timeZone keeps that implicit.
const TAIPEI_TIME_ZONE = 'Asia/Taipei';

function taipeiParts(value: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const byType: Record<string, string> = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }
  return byType;
}

// `2026/09/04 13:30:05` — the header/source timestamp style.
export function formatTaipeiDateTime(iso: string): string {
  const parts = taipeiParts(new Date(iso));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// `2026/09/04 收盤` — the market-overview EOD date style.
export function formatTaipeiDate(asOf: string): string {
  const [year, month, day] = asOf.split('-');
  return `${year}/${month}/${day}`;
}

// `13:30:05` — the market-overview intraday timestamp style.
export function formatTaipeiTime(iso: string): string {
  const parts = taipeiParts(new Date(iso));
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const ACTIVE_POLLING_INTERVAL_MS = 30_000;

/**
 * Checks if the given time falls into the regular weekday trading window
 * (Monday to Friday 08:55:00 ~ 13:35:00 Asia/Taipei).
 *
 * Note: This represents the regular weekly market window and does not
 * account for official TWSE national holiday closures or special trading days.
 */
export function isTaipeiTradingWindow(now = new Date()): boolean {
  const taipeiDate = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const weekday = taipeiDate.getUTCDay(); // 0: Sun, 1: Mon, ..., 6: Sat
  if (weekday === 0 || weekday === 6) {
    return false;
  }

  const hour = taipeiDate.getUTCHours();
  const minute = taipeiDate.getUTCMinutes();
  const second = taipeiDate.getUTCSeconds();
  const totalSeconds = hour * 3600 + minute * 60 + second;

  // 08:55:00 is 8 * 3600 + 55 * 60 = 32100
  // 13:35:00 is 13 * 3600 + 35 * 60 = 48900
  return totalSeconds >= 32100 && totalSeconds <= 48900;
}

/**
 * Calculates the next refetch interval for market overview.
 * - During trading window (Mon-Fri 08:55 ~ 13:35): returns 30,000 ms.
 * - Outside trading window: returns the delay until the next 08:55:00 trading window wake-up.
 *   This ensures long-lived open tabs automatically wake up and begin active polling at 08:55.
 */
export function getMarketOverviewRefetchInterval(now = new Date()): number {
  if (isTaipeiTradingWindow(now)) {
    return ACTIVE_POLLING_INTERVAL_MS;
  }

  const nowMs = now.getTime();
  const taipeiDate = new Date(nowMs + TAIPEI_OFFSET_MS);
  const year = taipeiDate.getUTCFullYear();
  const month = taipeiDate.getUTCMonth();
  const date = taipeiDate.getUTCDate();
  const weekday = taipeiDate.getUTCDay(); // 0: Sun, 1: Mon, ..., 6: Sat

  let daysUntilNext: number;
  const todayStartMs = Date.UTC(year, month, date, 8, 55, 0, 0) - TAIPEI_OFFSET_MS;

  if (weekday >= 1 && weekday <= 5) {
    if (nowMs < todayStartMs) {
      // Earlier today before 08:55
      daysUntilNext = 0;
    } else if (weekday === 5) {
      // Friday after 13:35 -> next is Monday (+3 days)
      daysUntilNext = 3;
    } else {
      // Monday to Thursday after 13:35 -> next is tomorrow (+1 day)
      daysUntilNext = 1;
    }
  } else if (weekday === 6) {
    // Saturday -> next is Monday (+2 days)
    daysUntilNext = 2;
  } else {
    // Sunday (0) -> next is Monday (+1 day)
    daysUntilNext = 1;
  }

  const targetDate = new Date(Date.UTC(year, month, date + daysUntilNext, 8, 55, 0, 0) - TAIPEI_OFFSET_MS);
  const diffMs = targetDate.getTime() - nowMs;
  return Math.max(1000, diffMs + 200);
}
