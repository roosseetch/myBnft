import { describe, expect, it } from 'vitest';
import { mergeConditions, minAccommodationCapacity } from '../src/config/conditions.js';
import type { Conditions } from '../src/types.js';

const base: Conditions = {
  adults: 1,
  children: [],
  searchStartDate: null,
  searchEndDate: '2026-12-31',
  stayDurations: [7],
  arrivalWeekdays: [1],
  excludedCategories: ['campsite', 'caravan', 'other'],
};

describe('mergeConditions', () => {
  it('falls back to file defaults when env vars are absent', () => {
    expect(mergeConditions(base, {})).toEqual(base);
  });

  it('overrides every mapped field from env vars', () => {
    const merged = mergeConditions(base, {
      MYCAMP_ADULTS: '2',
      MYCAMP_CHILDREN_AGES: '5,2',
      MYCAMP_SEARCH_START_DATE: '2026-07-14',
      MYCAMP_SEARCH_END_DATE: '2026-08-12',
      MYCAMP_STAY_DURATIONS: '2,3',
      MYCAMP_ARRIVAL_WEEKDAYS: '4,5',
    });
    expect(merged).toEqual({
      ...base,
      adults: 2,
      children: [5, 2],
      searchStartDate: '2026-07-14',
      searchEndDate: '2026-08-12',
      stayDurations: [2, 3],
      arrivalWeekdays: [4, 5],
    });
  });

  it('supports partial overrides', () => {
    const merged = mergeConditions(base, { MYCAMP_ADULTS: '2' });
    expect(merged.adults).toBe(2);
    expect(merged.stayDurations).toEqual([7]);
  });

  it('treats an explicitly empty children list as "no children"', () => {
    const merged = mergeConditions({ ...base, children: [4] }, { MYCAMP_CHILDREN_AGES: '' });
    expect(merged.children).toEqual([]);
  });

  it('throws a clear error on malformed values instead of silently ignoring them', () => {
    expect(() => mergeConditions(base, { MYCAMP_ADULTS: 'two' })).toThrow(/MYCAMP_ADULTS/);
    expect(() => mergeConditions(base, { MYCAMP_SEARCH_END_DATE: '31.12.2026' })).toThrow(
      /MYCAMP_SEARCH_END_DATE/,
    );
    expect(() => mergeConditions(base, { MYCAMP_ARRIVAL_WEEKDAYS: '0,8' })).toThrow(/ISO weekdays/);
    expect(() => mergeConditions(base, { MYCAMP_STAY_DURATIONS: '' })).toThrow(
      /MYCAMP_STAY_DURATIONS/,
    );
    expect(() => mergeConditions(base, { MYCAMP_CHILDREN_AGES: '5,x' })).toThrow(
      /MYCAMP_CHILDREN_AGES/,
    );
  });

  it('does not mutate the base object', () => {
    const snapshot = structuredClone(base);
    mergeConditions(base, { MYCAMP_CHILDREN_AGES: '1,2,3' });
    expect(base).toEqual(snapshot);
  });
});

describe('minAccommodationCapacity', () => {
  it('is always adults + number of children', () => {
    expect(minAccommodationCapacity({ adults: 2, children: [5, 2] })).toBe(4);
    expect(minAccommodationCapacity({ adults: 1, children: [] })).toBe(1);
  });
});
