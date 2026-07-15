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
 * Keep matches that (a) are not in an excluded category and (b) can sleep the
 * whole family — capacity derived from the effective conditions at query time.
 */
export function filterMatches(
  matches: CampMatch[],
  conditions: Pick<Conditions, 'adults' | 'children' | 'excludedCategories'>,
): CampMatch[] {
  const minCapacity = minAccommodationCapacity(conditions);
  return matches.filter(
    (m) =>
      !isExcludedCategory(m.category, conditions.excludedCategories) && m.personsMax >= minCapacity,
  );
}
