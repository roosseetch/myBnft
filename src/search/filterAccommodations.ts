import type { CampMatch, Conditions } from '../types.js';
import { minAccommodationCapacity } from '../config/conditions.js';

/**
 * Category filtering uses a DENYLIST (spec §4.2 quirk 3): categories observed
 * so far are campsite / caravan / other / pod / tipitent, but more exist on
 * the marketing site (Safari Tent, Woodlodge, Chalet, …). Excluding known-bad
 * categories means new/unseen ones are included by default rather than
 * silently dropped.
 */
export function isExcludedCategory(category: string, excludedCategories: string[]): boolean {
  return excludedCategories.some((c) => c.toLowerCase() === category.toLowerCase());
}

/**
 * Some accommodation *names* (not categories) are unsuitable regardless of
 * category/capacity — e.g. "Bungalow Cerebral" is designated for families
 * affected by cerebral palsy, not a general booking. Denylist by
 * case-insensitive SUBSTRING (not exact match), since a campsite may name
 * variants like "Bungalow Cerebral Deluxe" that should also be caught.
 */
export function isExcludedName(name: string, excludedNameSubstrings: string[]): boolean {
  return excludedNameSubstrings.some((n) => name.toLowerCase().includes(n.toLowerCase()));
}

/**
 * Keep matches that (a) are not in an excluded category, (b) are not an
 * excluded specific accommodation name, and (c) can sleep the whole family —
 * capacity derived from the effective conditions at query time.
 */
export function filterMatches(
  matches: CampMatch[],
  conditions: Pick<Conditions, 'adults' | 'children' | 'excludedCategories' | 'excludedNames'>,
): CampMatch[] {
  const minCapacity = minAccommodationCapacity(conditions);
  return matches.filter(
    (m) =>
      !isExcludedCategory(m.category, conditions.excludedCategories) &&
      !isExcludedName(m.name, conditions.excludedNames) &&
      m.personsMax >= minCapacity,
  );
}
