import { loadConditions } from './config/conditions.js';
import { generateDateWindows } from './search/dateWindows.js';
import { filterMatches } from './search/filterAccommodations.js';
import { searchWindow, toCampMatch } from './api/campingCare.js';

/**
 * Manual, one-off query against the live camping.care API — no encryption key,
 * no history file. Driven by the SAME MYCAMP_* env vars as the real scrape
 * (falling back to conditions.json for anything not overridden), so only
 * values that are actually part of the configured search conditions can be
 * exercised here — no extra ad-hoc fields like a specific accommodation id.
 *
 * Usage:
 *   MYCAMP_ADULTS=2 MYCAMP_CHILDREN_AGES=2,5 \
 *   MYCAMP_SEARCH_START_DATE=2026-09-01 MYCAMP_SEARCH_END_DATE=2026-09-07 \
 *   MYCAMP_ARRIVAL_WEEKDAYS=1,2,3,4,5 MYCAMP_STAY_DURATIONS=6 \
 *   npm run debug-search
 */
async function main(): Promise<void> {
  const conditions = loadConditions();
  const windows = generateDateWindows(conditions);
  console.log(
    `[debug-search] ${conditions.adults} adult(s), children ages [${conditions.children.join(',')}], ` +
      `${windows.length} date window(s) between ` +
      `${conditions.searchStartDate ?? 'today'} and ${conditions.searchEndDate}.`,
  );

  const scrapedAt = new Date().toISOString();
  let totalRaw = 0;

  for (const window of windows) {
    const result = await searchWindow(window, conditions);
    totalRaw += result.accommodations.length;

    const matches = result.accommodations
      .map((raw) => toCampMatch(raw, window, scrapedAt))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const filtered = filterMatches(matches, conditions);

    console.log(
      `[debug-search] ${window.arrival} → ${window.departure} (${window.durationNights}n): ` +
        `${result.accommodations.length} raw → ${matches.length} with a usable numeric_id/admin id → ` +
        `${filtered.length} after category/capacity filters` +
        (result.usedLumpedFallback ? ' (lumped children fallback used)' : '') +
        (result.possiblyTruncated ? ' (POSSIBLY TRUNCATED)' : ''),
    );
    if (filtered.length > 0) console.log(JSON.stringify(filtered, null, 2));
  }

  console.log(`[debug-search] done. ${totalRaw} raw result(s) across all windows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
