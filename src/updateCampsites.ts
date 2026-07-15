import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { CAMPSITE_SLUG_CANDIDATES } from './config/campsiteSlugCandidates.js';
import type { CampsiteInfo } from './types.js';

/**
 * (Re)builds src/config/campsites.json — a adminId -> { slug, name } table
 * used to turn a search result's admin id into a working booking URL and a
 * human-readable location name.
 *
 * There is no API endpoint that maps admin id <-> booking slug with the
 * public search token (both directions require a per-administration key we
 * don't have — see README). The only reliable signal is the rendered booking
 * page itself: booking.camping.care/{slug} sets each accommodation photo as a
 * CSS background-image whose URL embeds the admin id
 * (".../administration/{id}/..."), and the page <title> is the campsite's
 * display name. So this script drives a real (headless) browser over the
 * candidate slug list and reads both off the rendered page.
 *
 * A candidate slug that doesn't correspond to a real campsite lands on
 * booking.camping.care/not-found and is skipped — the marketing site's own
 * slugs (where these candidates come from) don't always match the booking
 * widget's slugs. Entries from a previous run are preserved unless this run
 * successfully resolves a *different* slug for the same admin id, so a
 * transient failure on one candidate doesn't drop already-known-good data.
 *
 * Usage: npm run update-campsites
 */

function campsitesFilePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, './config/campsites.json');
}

function loadExisting(): Record<string, CampsiteInfo> {
  const file = campsitesFilePath();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, CampsiteInfo>;
}

async function resolveSlug(
  page: import('playwright').Page,
  slug: string,
): Promise<{ adminId: string; name: string } | null> {
  // Not 'networkidle': the app opens a persistent Firestore long-polling
  // connection that never goes idle, so that wait condition always times out.
  await page.goto(`https://booking.camping.care/${slug}`, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () =>
        location.pathname === '/not-found' ||
        Array.from(document.querySelectorAll('*')).some((el) =>
          getComputedStyle(el).backgroundImage.includes('administration/'),
        ),
      { timeout: 15_000 },
    );
  } catch {
    return null; // neither a real campsite's photos nor a /not-found redirect showed up in time
  }

  if (new URL(page.url()).pathname === '/not-found') return null;

  const result = await page.evaluate(() => {
    const bg = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .map((el) => getComputedStyle(el).backgroundImage)
      .find((b) => b && b.includes('administration/'));
    const match = bg?.match(/administration\/(\d+)\//);
    return { title: document.title, adminId: match ? match[1] : null };
  });

  if (!result.adminId || result.title.startsWith('Easily book your next Holiday')) return null;
  return { adminId: result.adminId, name: result.title };
}

async function main(): Promise<void> {
  const table = loadExisting();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let resolved = 0;
  let skipped = 0;

  for (const slug of CAMPSITE_SLUG_CANDIDATES) {
    try {
      const result = await resolveSlug(page, slug);
      if (!result) {
        console.warn(`[myCamp] "${slug}" did not resolve to a real campsite — skipping.`);
        skipped++;
        continue;
      }
      table[result.adminId] = { slug, name: result.name };
      console.log(`[myCamp] admin ${result.adminId} → "${slug}" (${result.name})`);
      resolved++;
    } catch (err) {
      console.warn(`[myCamp] "${slug}" failed to load: ${(err as Error).message}`);
      skipped++;
    }
  }

  await browser.close();

  const sorted = Object.fromEntries(
    Object.entries(table).sort(([a], [b]) => Number(a) - Number(b)),
  );
  writeFileSync(campsitesFilePath(), JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `[myCamp] ${resolved} resolved, ${skipped} skipped this run. ` +
      `${Object.keys(sorted).length} total campsite(s) in campsites.json.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
