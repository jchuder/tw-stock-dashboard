import type { HistoryRange } from '@tw-stock-dashboard/contracts';

export interface HistoryWindow {
  from: string;
  to: string;
}

const RANGE_MONTHS: Record<HistoryRange, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
};

// Pure calendar math. `to` is the Asia/Taipei calendar date of now — never the
// UTC date, or a post-midnight Taipei request lands on yesterday. `from` goes
// back whole calendar months with month-end clamp (Mar 31 - 1m -> Feb 28/29).
// No date library: Intl formats the Taipei parts, the rest is arithmetic.
export function historyWindow(range: HistoryRange, nowMs: number): HistoryWindow {
  const to = taipeiParts(nowMs);
  return { from: shiftMonth(to, -RANGE_MONTHS[range]), to: formatDate(to) };
}

interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

const TAIPEI_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function taipeiParts(nowMs: number): YearMonthDay {
  const [year, month, day] = TAIPEI_FORMAT.format(new Date(nowMs))
    .split('-')
    .map((part) => Number(part));
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(date: YearMonthDay, deltaMonths: number): string {
  let year = date.year;
  let month = date.month + deltaMonths;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  const day = Math.min(date.day, daysInMonth(year, month));
  return formatDate({ year, month, day });
}

function formatDate(date: YearMonthDay): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}
