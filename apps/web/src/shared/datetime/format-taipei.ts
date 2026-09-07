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

// Monday to Friday 08:55 ~ 13:35 in Asia/Taipei
export function isTaipeiTradingWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const byType: Record<string, string> = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }

  const day = byType.weekday;
  if (day === 'Sat' || day === 'Sun') {
    return false;
  }

  const hour = Number(byType.hour);
  const minute = Number(byType.minute);
  const totalMinutes = hour * 60 + minute;

  // 08:55 is 8 * 60 + 55 = 535
  // 13:35 is 13 * 60 + 35 = 815
  return totalMinutes >= 535 && totalMinutes <= 815;
}


