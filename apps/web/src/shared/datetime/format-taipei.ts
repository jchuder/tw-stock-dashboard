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
