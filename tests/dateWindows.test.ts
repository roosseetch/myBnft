import { describe, expect, it } from 'vitest';
import { addDays, generateDateWindows, isoWeekday } from '../src/search/dateWindows.js';

describe('isoWeekday', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekday('2026-07-13')).toBe(1); // Monday
    expect(isoWeekday('2026-07-19')).toBe(7); // Sunday
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries correctly', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('generateDateWindows', () => {
  it('generates every allowed arrival × duration combination with correct departures', () => {
    const windows = generateDateWindows({
      searchStartDate: '2026-07-14', // Tuesday
      searchEndDate: '2026-07-27',
      stayDurations: [2, 3],
      arrivalWeekdays: [4, 5], // Thu, Fri
    });
    // Thursdays: 16, 23; Fridays: 17, 24 → 4 arrivals × 2 durations = 8 windows
    expect(windows).toHaveLength(8);
    expect(windows).toContainEqual({
      arrival: '2026-07-16',
      departure: '2026-07-18',
      durationNights: 2,
    });
    expect(windows).toContainEqual({
      arrival: '2026-07-24',
      departure: '2026-07-27',
      durationNights: 3,
    });
    for (const w of windows) {
      expect([4, 5]).toContain(isoWeekday(w.arrival));
      expect(w.departure).toBe(addDays(w.arrival, w.durationNights));
    }
  });

  it('uses "today" when searchStartDate is null', () => {
    const windows = generateDateWindows(
      {
        searchStartDate: null,
        searchEndDate: '2026-07-20',
        stayDurations: [7],
        arrivalWeekdays: [1],
      },
      '2026-07-14',
    );
    expect(windows).toEqual([
      { arrival: '2026-07-20', departure: '2026-07-27', durationNights: 7 },
    ]);
  });

  it('includes the end date itself (inclusive range)', () => {
    const windows = generateDateWindows({
      searchStartDate: '2026-07-13',
      searchEndDate: '2026-07-13',
      stayDurations: [1],
      arrivalWeekdays: [1],
    });
    expect(windows).toHaveLength(1);
  });

  it('returns an empty list when the range is empty or no weekday matches', () => {
    expect(
      generateDateWindows({
        searchStartDate: '2026-08-01',
        searchEndDate: '2026-07-01',
        stayDurations: [7],
        arrivalWeekdays: [1],
      }),
    ).toEqual([]);
    expect(
      generateDateWindows({
        searchStartDate: '2026-07-14', // Tue
        searchEndDate: '2026-07-15', // Wed
        stayDurations: [7],
        arrivalWeekdays: [1], // Mondays only
      }),
    ).toEqual([]);
  });
});
