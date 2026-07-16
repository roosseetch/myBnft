import { describe, expect, it, vi } from 'vitest';
import {
  REQUEST_LIMIT,
  buildBookingUrl,
  buildLocationUrl,
  extractAdminId,
  lumpedAgeCategories,
  searchWindow,
  splitAgeCategories,
  toCampMatch,
} from '../src/api/campingCare.js';
import type { DateWindow } from '../src/types.js';

const window: DateWindow = { arrival: '2026-07-16', departure: '2026-07-18', durationNights: 2 };
const family = { adults: 2, children: [5, 2] }; // 5yo → children, 2yo → young_children (guess)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('age category shapes', () => {
  it('splits by the young-child age cutoff', () => {
    expect(splitAgeCategories(2, [5, 2])).toEqual([
      { id: 'adults', count: 2 },
      { id: 'young_children', count: 1 },
      { id: 'children', count: 1 },
    ]);
  });

  it('lumps all kids under "children" in the fallback shape', () => {
    expect(lumpedAgeCategories(2, [5, 2])).toEqual([
      { id: 'adults', count: 2 },
      { id: 'children', count: 2 },
    ]);
  });

  it('omits zero-count buckets', () => {
    expect(splitAgeCategories(1, [])).toEqual([{ id: 'adults', count: 1 }]);
    expect(lumpedAgeCategories(1, [])).toEqual([{ id: 'adults', count: 1 }]);
  });
});

describe('searchWindow', () => {
  it('uses the optimistic young_children split when the API accepts it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(decodeURIComponent(url)).toContain('"young_children"');
      // Real API wraps results in { data: [...] }, not a bare array (regression).
      return jsonResponse({ data: [{ id: 'acc_1', numeric_id: 1, thumbnail: 'https://cdn/administration/42/x.jpg' }] });
    });
    const result = await searchWindow(window, family, fetchMock as any, () => {});
    expect(result.usedLumpedFallback).toBe(false);
    expect(result.accommodations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses the real { data: [...] } response wrapper (regression: code used to only accept a bare array or { accommodations })', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'acc_9', numeric_id: 9 }, { id: 'acc_10', numeric_id: 10 }] }),
    );
    const result = await searchWindow(window, { adults: 1, children: [] }, fetchMock as any, () => {});
    expect(result.accommodations).toHaveLength(2);
  });

  it('falls back to lumped "children" on a 400 and logs the eligibility warning', async () => {
    const logs: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (decodeURIComponent(url).includes('"young_children"'))
        return jsonResponse({ error: 'bad shape' }, 400);
      expect(decodeURIComponent(url)).toContain('{"id":"children","count":2}');
      return jsonResponse([{ id: 2, thumbnail: 'https://cdn/administration/7/y.jpg' }]);
    });
    const result = await searchWindow(window, family, fetchMock as any, (m) => logs.push(m));
    expect(result.usedLumpedFallback).toBe(true);
    expect(result.accommodations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).toMatch(/verify pricing\/eligibility/);
  });

  it('does not attempt a fallback when there are no young children', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'nope' }, 400));
    await expect(
      searchWindow(window, { adults: 2, children: [5, 8] }, fetchMock as any, () => {}),
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns loudly on possible truncation (length === limit) instead of paginating', async () => {
    const logs: string[] = [];
    const page = Array.from({ length: REQUEST_LIMIT }, (_, i) => ({ id: i }));
    const fetchMock = vi.fn(async () => jsonResponse(page));
    const result = await searchWindow(window, { adults: 1, children: [] }, fetchMock as any, (m) =>
      logs.push(m),
    );
    expect(result.possiblyTruncated).toBe(true);
    expect(logs.join('\n')).toMatch(/possible truncation/);
  });

  it('throws on non-4xx failures', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    await expect(searchWindow(window, family, fetchMock as any, () => {})).rejects.toThrow(
      /HTTP 503/,
    );
  });
});

describe('buildBookingUrl', () => {
  it('builds a real booking link when the campsite slug is known', () => {
    expect(buildBookingUrl(182027, 'tcs-camping-salavaux-plage')).toBe(
      'https://booking.camping.care/tcs-camping-salavaux-plage/accommodations/182027?accommodation=182027',
    );
  });

  it('returns null instead of a placeholder link when the slug is unknown', () => {
    expect(buildBookingUrl(182027, null)).toBeNull();
  });
});

describe('buildLocationUrl', () => {
  it('builds the TCS marketing site link when the campsite slug is known', () => {
    expect(buildLocationUrl('tcs-camping-thusis-viamala')).toBe(
      'https://camping.tcs.ch/de/campingplaetze/tcs-camping-thusis-viamala/',
    );
  });

  it('returns null when the slug is unknown', () => {
    expect(buildLocationUrl(null)).toBeNull();
  });
});

describe('extractAdminId', () => {
  it('pulls the id out of a thumbnail URL', () => {
    expect(extractAdminId('https://cdn.camping.care/administration/12345/photos/1.jpg')).toBe(
      '12345',
    );
  });
  it('returns null when absent', () => {
    expect(extractAdminId('https://cdn.camping.care/other/1.jpg')).toBeNull();
    expect(extractAdminId(undefined)).toBeNull();
  });
});

describe('toCampMatch', () => {
  it('builds a CampMatch, falling back gracefully when the admin id is not in campsites.json', () => {
    // "id" is the API's opaque string id — accommodationId must come from numeric_id (see bug below).
    // admin 55 is not a real admin id, so this exercises the "unknown campsite" fallback path.
    const match = toCampMatch(
      {
        id: 'acc_991',
        numeric_id: 991,
        name: 'Family Pod',
        category: 'pod',
        persons_max: 4,
        price_total: 210.5,
        thumbnail: 'https://cdn.camping.care/administration/55/p.jpg',
      },
      window,
      '2026-07-14T06:00:00.000Z',
    );
    expect(match).toMatchObject({
      adminId: '55',
      locationName: 'Admin 55',
      locationUrl: null,
      accommodationId: 991,
      name: 'Family Pod',
      category: 'pod',
      personsMax: 4,
      priceTotal: 210.5,
      currency: 'CHF',
      bookingUrl: null,
    });
  });

  it('returns null when numeric_id is missing (regression: "id" is always a string, never the numeric id)', () => {
    expect(
      toCampMatch(
        { id: 'acc_1', thumbnail: 'https://cdn.camping.care/administration/55/p.jpg' },
        window,
        '2026-07-14T06:00:00.000Z',
      ),
    ).toBeNull();
  });

  it('returns null when the campsite id cannot be derived', () => {
    expect(toCampMatch({ id: 'acc_1', numeric_id: 1 }, window, '2026-07-14T06:00:00.000Z')).toBeNull();
  });
});
