import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CampMatch, CampsiteInfo, Conditions, DateWindow } from '../types.js';

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
 * The search response contains no direct booking URL, and the real one
 * requires the campsite's booking slug (no placeholder works — confirmed by
 * hitting the actual booking flow; see src/config/campsites.json). Returns
 * null when the campsite's slug isn't known yet rather than emitting a link
 * that 404s.
 */
export function buildBookingUrl(accommodationId: number, slug: string | null): string | null {
  if (!slug) return null;
  return `https://booking.camping.care/${slug}/accommodations/${accommodationId}?accommodation=${accommodationId}`;
}

/**
 * The campsite's page on the TCS marketing site. The slug from
 * v21/administrations/{id} (see resolveCampsite() below) matches this path
 * directly — confirmed by cross-checking known campsites.
 */
export function buildLocationUrl(slug: string | null): string | null {
  if (!slug) return null;
  return `https://camping.tcs.ch/de/campingplaetze/${slug}/`;
}

export interface RawAccommodation {
  /** Opaque string id (e.g. "acc_..."); NOT the numeric accommodation id — see numeric_id. */
  id: string;
  /** The actual numeric accommodation id used everywhere else (booking urls, live-cache lookups). */
  numeric_id?: number;
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
  // The real response shape is { data: [...] } — bare-array and { accommodations }
  // are kept as defensive fallbacks in case the API's wrapper ever changes.
  const items = Array.isArray(body)
    ? (body as RawAccommodation[])
    : Array.isArray((body as any)?.data)
      ? ((body as any).data as RawAccommodation[])
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

/**
 * admin id -> resolved campsite info, or null for an admin id that was looked
 * up and found unresolvable (inactive, or the API call failed) this run.
 * Load with loadCampsiteDirectory(), persist with saveCampsiteDirectory() —
 * negative (null) entries are never written to disk, so a previously-failed
 * admin id is retried on the next run rather than staying stuck forever.
 */
export type CampsiteDirectory = Record<string, CampsiteInfo | null>;

function campsitesFilePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../config/campsites.json');
}

export function loadCampsiteDirectory(): CampsiteDirectory {
  const file = campsitesFilePath();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as CampsiteDirectory;
}

export function saveCampsiteDirectory(directory: CampsiteDirectory): void {
  const sorted = Object.fromEntries(
    Object.entries(directory)
      .filter((entry): entry is [string, CampsiteInfo] => entry[1] != null)
      .sort(([a], [b]) => Number(a) - Number(b)),
  );
  writeFileSync(campsitesFilePath(), JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Resolves a campsite's real name/booking-slug straight from camping.care's
 * own API — no scraping or guessing needed. v21/administrations/{numericId}
 * works with the public multi-network token (unlike the slug-keyed or
 * accommodation-keyed v21 endpoints, which return "No valid API key found
 * for this administration" — those need a per-administration key we don't
 * have). Only administrations with status "active" are accepted, so a
 * closed/inactive campsite id isn't treated as resolved.
 */
export async function resolveCampsite(
  adminId: string,
  directory: CampsiteDirectory,
  fetchImpl: FetchLike = fetch,
): Promise<CampsiteInfo | null> {
  if (adminId in directory) return directory[adminId] ?? null;

  try {
    const res = await fetchImpl(`https://api.camping.care/v21/administrations/${adminId}`, {
      headers: { Authorization: `Bearer ${TCS_PUBLIC_API_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      directory[adminId] = null;
      return null;
    }
    const body = (await res.json()) as { name?: unknown; slug?: unknown; status?: unknown };
    if (body.status !== 'active' || typeof body.name !== 'string' || typeof body.slug !== 'string') {
      directory[adminId] = null;
      return null;
    }
    const info: CampsiteInfo = { slug: body.slug, name: body.name };
    directory[adminId] = info;
    return info;
  } catch {
    directory[adminId] = null;
    return null;
  }
}

/** Convert one raw accommodation into a CampMatch (returns null if essentials are missing). */
export async function toCampMatch(
  raw: RawAccommodation,
  window: DateWindow,
  scrapedAt: string,
  directory: CampsiteDirectory,
  fetchImpl: FetchLike = fetch,
): Promise<CampMatch | null> {
  const adminId = extractAdminId(raw.thumbnail);
  const price = typeof raw.price_total === 'number' ? raw.price_total : raw.price;
  if (typeof raw.numeric_id !== 'number' || adminId === null) return null;
  const campsite = await resolveCampsite(adminId, directory, fetchImpl);
  return {
    scrapedAt,
    adminId,
    locationName: campsite?.name ?? `Admin ${adminId}`,
    locationUrl: buildLocationUrl(campsite?.slug ?? null),
    accommodationId: raw.numeric_id,
    name: raw.name ?? `Accommodation ${raw.numeric_id}`,
    category: raw.category ?? 'unknown',
    personsMax: typeof raw.persons_max === 'number' ? raw.persons_max : 0,
    arrival: window.arrival,
    departure: window.departure,
    durationNights: window.durationNights,
    priceTotal: typeof price === 'number' ? price : 0,
    currency: 'CHF',
    bookingUrl: buildBookingUrl(raw.numeric_id, campsite?.slug ?? null),
  };
}
