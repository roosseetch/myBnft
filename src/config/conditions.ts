import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Conditions } from '../types.js';

/**
 * Env var → conditions field mapping (see README / spec §3).
 *
 *   MYCAMP_ADULTS              → adults
 *   MYCAMP_CHILDREN_AGES       → children      (comma-separated ages)
 *   MYCAMP_SEARCH_START_DATE   → searchStartDate
 *   MYCAMP_SEARCH_END_DATE     → searchEndDate
 *   MYCAMP_STAY_DURATIONS      → stayDurations (comma-separated nights)
 *   MYCAMP_ARRIVAL_WEEKDAYS    → arrivalWeekdays (comma-separated ISO weekday numbers)
 *
 * There is deliberately NO override for minimum accommodation capacity:
 * it is always derived via minAccommodationCapacity(), so it can never
 * drift out of sync with the actual family size.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class ConditionsError extends Error {}

function parsePositiveInt(raw: string, name: string): number {
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new ConditionsError(
      `Malformed env var ${name}: expected a non-negative integer, got "${raw}"`,
    );
  }
  return n;
}

function parseIntList(raw: string, name: string): number[] {
  if (raw.trim() === '') {
    // Explicitly-empty list, e.g. MYCAMP_CHILDREN_AGES="" means "no children".
    return [];
  }
  return raw.split(',').map((part) => parsePositiveInt(part, name));
}

function parseIsoDate(raw: string, name: string): string {
  const v = raw.trim();
  if (!ISO_DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ConditionsError(`Malformed env var ${name}: expected YYYY-MM-DD, got "${raw}"`);
  }
  return v;
}

function parseWeekdayList(raw: string, name: string): number[] {
  const list = parseIntList(raw, name);
  for (const d of list) {
    if (d < 1 || d > 7) {
      throw new ConditionsError(
        `Malformed env var ${name}: ISO weekdays are 1 (Mon) … 7 (Sun), got ${d}`,
      );
    }
  }
  return list;
}

/**
 * Pure merge: given base conditions (from conditions.json) and an env-like
 * record, return the effective conditions. Absent env vars fall back to the
 * file defaults; malformed env vars throw a clear ConditionsError.
 */
export function mergeConditions(
  base: Conditions,
  env: Record<string, string | undefined>,
): Conditions {
  const out: Conditions = { ...base, children: [...base.children] };

  if (env.MYCAMP_ADULTS !== undefined)
    out.adults = parsePositiveInt(env.MYCAMP_ADULTS, 'MYCAMP_ADULTS');
  if (env.MYCAMP_CHILDREN_AGES !== undefined)
    out.children = parseIntList(env.MYCAMP_CHILDREN_AGES, 'MYCAMP_CHILDREN_AGES');
  if (env.MYCAMP_SEARCH_START_DATE !== undefined)
    out.searchStartDate = parseIsoDate(env.MYCAMP_SEARCH_START_DATE, 'MYCAMP_SEARCH_START_DATE');
  if (env.MYCAMP_SEARCH_END_DATE !== undefined)
    out.searchEndDate = parseIsoDate(env.MYCAMP_SEARCH_END_DATE, 'MYCAMP_SEARCH_END_DATE');
  if (env.MYCAMP_STAY_DURATIONS !== undefined) {
    out.stayDurations = parseIntList(env.MYCAMP_STAY_DURATIONS, 'MYCAMP_STAY_DURATIONS');
    if (out.stayDurations.length === 0 || out.stayDurations.some((n) => n < 1)) {
      throw new ConditionsError(
        'Malformed env var MYCAMP_STAY_DURATIONS: need at least one night count >= 1',
      );
    }
  }
  if (env.MYCAMP_ARRIVAL_WEEKDAYS !== undefined)
    out.arrivalWeekdays = parseWeekdayList(env.MYCAMP_ARRIVAL_WEEKDAYS, 'MYCAMP_ARRIVAL_WEEKDAYS');

  if (out.adults < 1) {
    throw new ConditionsError('Effective conditions invalid: need at least 1 adult');
  }
  return out;
}

/**
 * Minimum accommodation capacity is ALWAYS derived from the effective family
 * size — one small pure function so it cannot drift out of sync.
 */
export function minAccommodationCapacity(
  conditions: Pick<Conditions, 'adults' | 'children'>,
): number {
  return conditions.adults + conditions.children.length;
}

/** Load conditions.json from the repo root and apply env overrides. */
export function loadConditions(env: Record<string, string | undefined> = process.env): Conditions {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, '../../conditions.json');
  const base = JSON.parse(readFileSync(file, 'utf8')) as Conditions;
  return mergeConditions(base, env);
}
