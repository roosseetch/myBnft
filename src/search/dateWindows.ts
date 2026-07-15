import type { Conditions, DateWindow } from '../types.js';

/** Format a Date as YYYY-MM-DD (UTC — all dates in this project are calendar dates). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const day = parseUtc(isoDate).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return day === 0 ? 7 : day;
}

export function addDays(isoDate: string, days: number): string {
  const d = parseUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/**
 * Generate every (arrival, duration) pair to query:
 *  - arrival ranges from searchStartDate (or `today`) to searchEndDate inclusive,
 *    keeping only dates whose ISO weekday is in arrivalWeekdays;
 *  - duration iterates over stayDurations;
 *  - departure = arrival + duration nights.
 */
export function generateDateWindows(
  conditions: Pick<
    Conditions,
    'searchStartDate' | 'searchEndDate' | 'stayDurations' | 'arrivalWeekdays'
  >,
  today: string = toIsoDate(new Date()),
): DateWindow[] {
  const start = conditions.searchStartDate ?? today;
  const end = conditions.searchEndDate;
  const windows: DateWindow[] = [];
  if (start > end) return windows;

  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (!conditions.arrivalWeekdays.includes(isoWeekday(date))) continue;
    for (const nights of conditions.stayDurations) {
      windows.push({ arrival: date, departure: addDays(date, nights), durationNights: nights });
    }
  }
  return windows;
}
