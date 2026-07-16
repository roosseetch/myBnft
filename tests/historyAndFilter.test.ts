import { describe, expect, it } from 'vitest';
import { filterMatches } from '../src/search/filterAccommodations.js';
import { mergeMatches, emptyHistory } from '../src/storage/history.js';
import type { CampMatch } from '../src/types.js';

function match(overrides: Partial<CampMatch>): CampMatch {
  return {
    scrapedAt: '2026-07-14T06:00:00.000Z',
    adminId: '1',
    locationName: 'Test Campsite',
    accommodationId: 100,
    name: 'Pod',
    category: 'pod',
    personsMax: 4,
    arrival: '2026-07-16',
    departure: '2026-07-18',
    durationNights: 2,
    priceTotal: 200,
    currency: 'CHF',
    bookingUrl: 'https://booking.camping.care/test-campsite/accommodations/100?accommodation=100',
    ...overrides,
  };
}

describe('filterMatches', () => {
  const conditions = {
    adults: 2,
    children: [5, 2],
    excludedCategories: ['campsite', 'caravan', 'other'],
  };

  it('drops denylisted categories but keeps unknown/new ones', () => {
    const kept = filterMatches(
      [
        match({ category: 'campsite' }),
        match({ category: 'pod' }),
        match({ category: 'SwissTube' }),
      ],
      conditions,
    );
    expect(kept.map((m) => m.category)).toEqual(['pod', 'SwissTube']);
  });

  it('matches the denylist case-insensitively', () => {
    expect(filterMatches([match({ category: 'Caravan' })], conditions)).toEqual([]);
  });

  it('drops accommodations too small for the family (capacity derived, not configured)', () => {
    const kept = filterMatches([match({ personsMax: 3 }), match({ personsMax: 4 })], conditions);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.personsMax).toBe(4);
  });
});

describe('mergeMatches', () => {
  it('dedupes on adminId+accommodationId+arrival+durationNights, keeping newest price/scrapedAt', () => {
    const history = {
      ...emptyHistory(),
      matches: [match({ priceTotal: 200, scrapedAt: '2026-07-13T06:00:00.000Z' })],
    };
    const merged = mergeMatches(
      history,
      [match({ priceTotal: 185, scrapedAt: '2026-07-14T06:00:00.000Z' })],
      [{ arrival: '2026-07-16', durationNights: 2 }],
    );
    expect(merged.matches).toHaveLength(1);
    expect(merged.matches[0]?.priceTotal).toBe(185);
    expect(merged.matches[0]?.scrapedAt).toBe('2026-07-14T06:00:00.000Z');
  });

  it('treats a different arrival or duration as a distinct match', () => {
    const history = { ...emptyHistory(), matches: [match({})] };
    const merged = mergeMatches(
      history,
      [match({ arrival: '2026-07-17' }), match({ durationNights: 3 })],
      [
        { arrival: '2026-07-17', durationNights: 2 },
        { arrival: '2026-07-16', durationNights: 3 },
      ],
    );
    expect(merged.matches).toHaveLength(3);
  });

  it('preserves keyVersion', () => {
    const merged = mergeMatches({ keyVersion: 5, matches: [] }, [match({})], [
      { arrival: '2026-07-16', durationNights: 2 },
    ]);
    expect(merged.keyVersion).toBe(5);
  });

  it('drops a match whose window was actively searched but no longer comes back (sold out/removed)', () => {
    const history = {
      ...emptyHistory(),
      matches: [
        match({ accommodationId: 100 }),
        match({ accommodationId: 200 }),
      ],
    };
    const merged = mergeMatches(
      history,
      [match({ accommodationId: 100 })], // only 100 still shows up
      [{ arrival: '2026-07-16', durationNights: 2 }], // this window WAS searched
    );
    expect(merged.matches.map((m) => m.accommodationId)).toEqual([100]);
  });

  it('leaves a match untouched when its window falls outside what was searched this run', () => {
    const history = { ...emptyHistory(), matches: [match({})] };
    // Nothing fresh, and this run didn't search that window at all — e.g. the
    // configured search window has since narrowed. The old entry must survive.
    const merged = mergeMatches(history, [], []);
    expect(merged.matches).toHaveLength(1);
  });
});
