import type { CampMatch, Conditions, DateWindow } from '../types.js';

/**
 * Publishable/public API token for the TCS Camping instance of camping.care.
 *
 * Provenance: observed in requests made by https://camping.tcs.ch/de/campingplatz-suche/
 * to https://api.camping.care/v3/accommodations/search (browser devtools → Network tab,
 * filter for "accommodations/search"). The `pub_` prefix indicates a publishable key
 * intended to be shipped to browsers. If camping.care ever rotates it and searches start
 * failing with 401/403, re-capture it the same way and update this constant.
 */
export const TCS_PUBLIC_API_TOKEN =
  'pub_bGl2ZS1hZG1fMjIyY2I0YjNlOWQwNGJiN2JhZjg4M2U2OTkyMTQ4ZjMtdXNyXzJSbjVGVFN4TXpnOFJ5NHpmQ1FSN3doY296RTMtRXdXWGJkU2tNUmRHQkM0ODlsRWVhS1lKcllyMDlPclgtYXBpXzBmNjNlZDRiYmI4NjQ1ZWY4ZjgyNDI0ODk2MDA1YjEy';

const SEARCH_URL = 'https://api.camping.care/v3/accommodations/search';

/**
 * The endpoint clamps `limit` somewhere above 20, and offset-based pagination
 * past the first page has been observed returning 0 results even when more
 * should exist — so we do NOT paginate. We request one big page and warn
 * loudly if it looks truncated (returned length === requested limit).
 */
export const REQUEST_LIMIT = 500;

/**
 * Age cutoff GUESS for the unconfirmed "young_children" bucket: children
 * strictly younger than this many years are attempted as young_children.
 * Swiss camping pricing conventions commonly treat under-3s as a separate
 * tier, but the v3 search endpoint has never been observed confirming this
 * bucket — hence the fallback logic in searchWindow().
 */
export const YOUNG_CHILD_AGE_LIMIT = 3;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface AgeCategory {
  id: string;
  count: number;
}

/** Split children ages into the optimistic (young_children + children) shape. */
export function splitAgeCategories(adults: number, childrenAges: number[]): AgeCategory[] {
  const young = childrenAges.filter((a) => a < YOUNG_CHILD_AGE_LIMIT).length;
  const older = childrenAges.length - young;
  const cats: AgeCategory[] = [{ id: 'adults', count: adults }];
  if (young > 0) cats.push({ id: 'young_children', count: young });
  if (older > 0) cats.push({ id: 'children', count: older });
  return cats;
}

/** The confirmed-safe shape: everyone under 18 lumped under "children". */
export function lumpedAgeCategories(adults: number, childrenAges: number[]): AgeCategory[] {
  const cats: AgeCategory[] = [{ id: 'adults', count: adults }];
  if (childrenAges.length > 0) cats.push({ id: 'children', count: childrenAges.length });
  return cats;
}

function buildUrl(window: DateWindow, ageCategories: AgeCategory[]): string {
  const params = new URLSearchParams({
    offset: '0',
    limit: String(REQUEST_LIMIT),
    arrival: window.arrival,
    departure: window.departure,
    age_table_categories: JSON.stringify(ageCategories),
    stock: JSON.stringify({ stock: 1, operator: 'GTE' }),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

/** Extract the campsite admin id from a result's thumbnail URL (no explicit field exists). */
export function extractAdminId(thumbnailUrl: string | undefined | null): string | null {
  if (!thumbnailUrl) return null;
  const m = /administration\/(\d+)\//.exec(thumbnailUrl);
  return m ? (m[1] ?? null) : null;
}

/**
 * Fallback booking link. The search response contains no direct booking URL;
 * this pattern (accommodation id only, no campsite slug) was confirmed to
 * resolve in manual testing. Re-verify if camping.care changes their router.
 */
export function buildBookingUrl(accommodationId: number): string {
  return `https://booking.camping.care/_/accommodations/${accommodationId}?accommodation=${accommodationId}`;
}

export interface RawAccommodation {
  id: number;
  name?: string;
  category?: string;
  persons_max?: number;
  price?: number;
  price_total?: number;
  currency?: string;
  thumbnail?: string;
  [key: string]: unknown;
}

export interface SearchWindowResult {
  accommodations: RawAccommodation[];
  /** true if the optimistic young_children split was rejected and we lumped kids together. */
  usedLumpedFallback: boolean;
  /** true if the response length hit REQUEST_LIMIT exactly (possible truncation). */
  possiblyTruncated: boolean;
}

async function requestOnce(
  fetchImpl: FetchLike,
  window: DateWindow,
  ageCategories: AgeCategory[],
): Promise<{ ok: boolean; status: number; items: RawAccommodation[] }> {
  const res = await fetchImpl(buildUrl(window, ageCategories), {
    headers: {
      Authorization: `Bearer ${TCS_PUBLIC_API_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return { ok: false, status: res.status, items: [] };
  const body = (await res.json()) as unknown;
  const items = Array.isArray(body)
    ? (body as RawAccommodation[])
    : Array.isArray((body as any)?.accommodations)
      ? ((body as any).accommodations as RawAccommodation[])
      : [];
  return { ok: true, status: res.status, items };
}

/**
 * Resilient wrapper around one search window (spec §4.2 quirk 2):
 *
 *  1. First attempt splits kids by age, guessing a `young_children` bucket exists.
 *  2. On a 4xx rejection of that shape, fall back to lumping all kids under
 *     `children` and log clearly so pricing/eligibility for the youngest child
 *     can be verified manually before booking.
 *
 * Non-4xx failures (network, 5xx) are thrown so the caller can decide.
 */
export async function searchWindow(
  window: DateWindow,
  conditions: Pick<Conditions, 'adults' | 'children'>,
  fetchImpl: FetchLike = fetch,
  log: (msg: string) => void = console.warn,
): Promise<SearchWindowResult> {
  const split = splitAgeCategories(conditions.adults, conditions.children);
  const needsSplit = split.some((c) => c.id === 'young_children');

  let usedLumpedFallback = false;
  let result = await requestOnce(fetchImpl, window, split);

  if (!result.ok && needsSplit && result.status >= 400 && result.status < 500) {
    log(
      `[myCamp] ${window.arrival} (+${window.durationNights}n): API rejected the young_children/children ` +
        `split (HTTP ${result.status}). Falling back to a single "children" bucket — per-age granularity ` +
        `was NOT available, so manually verify pricing/eligibility for the youngest child before booking.`,
    );
    usedLumpedFallback = true;
    result = await requestOnce(
      fetchImpl,
      window,
      lumpedAgeCategories(conditions.adults, conditions.children),
    );
  }

  if (!result.ok) {
    throw new Error(
      `camping.care search failed for ${window.arrival} → ${window.departure} (HTTP ${result.status})`,
    );
  }

  const possiblyTruncated = result.items.length === REQUEST_LIMIT;
  if (possiblyTruncated) {
    log(
      `[myCamp] WARNING: ${window.arrival} (+${window.durationNights}n) returned exactly ${REQUEST_LIMIT} ` +
        `items — possible truncation, results may be incomplete (offset pagination is unreliable on this API).`,
    );
  }

  return { accommodations: result.items, usedLumpedFallback, possiblyTruncated };
}

/** Convert one raw accommodation into a CampMatch (returns null if essentials are missing). */
export function toCampMatch(
  raw: RawAccommodation,
  window: DateWindow,
  scrapedAt: string,
): CampMatch | null {
  const adminId = extractAdminId(raw.thumbnail);
  const price = typeof raw.price_total === 'number' ? raw.price_total : raw.price;
  if (typeof raw.id !== 'number' || adminId === null) return null;
  return {
    scrapedAt,
    adminId,
    accommodationId: raw.id,
    name: raw.name ?? `Accommodation ${raw.id}`,
    category: raw.category ?? 'unknown',
    personsMax: typeof raw.persons_max === 'number' ? raw.persons_max : 0,
    arrival: window.arrival,
    departure: window.departure,
    durationNights: window.durationNights,
    priceTotal: typeof price === 'number' ? price : 0,
    currency: 'CHF',
    bookingUrl: buildBookingUrl(raw.id),
  };
}
