import { loadConditions } from './config/conditions.js';
import { generateDateWindows } from './search/dateWindows.js';
import { filterMatches } from './search/filterAccommodations.js';
import { searchWindow, toCampMatch } from './api/campingCare.js';
import { readHistory, mergeMatches, writeHistory } from './storage/history.js';
import type { CampMatch, HistoryFile } from './types.js';

/** Small politeness delay between API calls (the windows loop can be long). */
const DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function requireKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.MYCAMP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'MYCAMP_ENCRYPTION_KEY is not set. In GitHub Actions it comes from the repo VARIABLE ' +
        'MYCAMP_ENCRYPTION_KEY (Settings → Secrets and variables → Actions → Variables). ' +
        'Generate one locally with: npm run init-key',
    );
  }
  return key;
}

/**
 * Run the full search across all candidate windows and merge into `history`.
 * Shared by the daily scrape and the weekly rotation (which scrapes first so
 * rotation day is not lost/duplicated across two runs).
 */
export async function runScrape(history: HistoryFile): Promise<HistoryFile> {
  const conditions = loadConditions();
  const windows = generateDateWindows(conditions);
  console.log(
    `[myCamp] Searching ${windows.length} date window(s) ` +
      `(${conditions.adults} adult(s), ${conditions.children.length} child(ren)).`,
  );

  const fresh: CampMatch[] = [];
  const scrapedAt = new Date().toISOString();
  let fallbackUsed = false;

  for (const window of windows) {
    const result = await searchWindow(window, conditions);
    fallbackUsed ||= result.usedLumpedFallback;
    for (const raw of result.accommodations) {
      const match = toCampMatch(raw, window, scrapedAt);
      if (match) fresh.push(match);
    }
    await sleep(DELAY_MS);
  }

  const filtered = filterMatches(fresh, conditions);
  console.log(
    `[myCamp] ${fresh.length} raw result(s) → ${filtered.length} after category/capacity filters.`,
  );
  if (fallbackUsed) {
    console.warn(
      '[myCamp] NOTE: per-age (young_children) granularity was unavailable for at least one query; ' +
        'verify pricing/eligibility for the youngest child on results before booking.',
    );
  }

  return mergeMatches(history, filtered);
}

async function main(): Promise<void> {
  const key = requireKey();
  const history = await readHistory(key);
  const updated = await runScrape(history);
  await writeHistory(updated, key); // re-encrypted with the SAME current key
  console.log(
    `[myCamp] History now holds ${updated.matches.length} match(es). Wrote data/encrypted-history.json.`,
  );
}

// Only run when executed directly (rotateKey.ts imports runScrape without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
