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
 * booking.camping.care/not-found and is skipped. Candidates come from two
 * places: (1) camping.tcs.ch's own search page (camping.tcs.ch/de/campingplatz-suche/)
 * embeds a Gatsby static-query result (fetched as one of several
 * /page-data/sq/d/{hash}.json files — the hash isn't stable across builds,
 * so it's found at runtime, not hardcoded) containing `data.allCampsites`,
 * each with a `campingCareSlug` field. This is the authoritative source:
 * the marketing site's own page *path* slug is sometimes subtly different
 * from campingCareSlug (umlaut transliteration, entirely different wording,
 * or a disambiguating suffix like "1" because the "bare" slug hits an
 * internal test duplicate) — see git history for concrete examples. (2) a
 * static fallback list (campsiteSlugCandidates.ts) in case that discovery
 * ever fails. Entries from a previous run are preserved unless this run
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

/**
 * camping.tcs.ch's search page loads its full campsite list as a Gatsby
 * static-query result — one of several /page-data/sq/d/{hash}.json requests
 * it makes on load. The hash is content-derived and changes across builds,
 * so we can't hardcode the URL; instead capture every such response while
 * the page loads and keep whichever one has `data.allCampsites`.
 */
async function discoverSlugsFromMarketingSite(
  browser: import('playwright').Browser,
): Promise<string[]> {
  const page = await browser.newPage();
  const sqBodies: unknown[] = [];
  page.on('response', (res) => {
    if (/\/page-data\/sq\/d\/\d+\.json$/.test(new URL(res.url()).pathname)) {
      sqBodies.push(
        res
          .json()
          .catch(() => null),
      );
    }
  });

  await page.goto('https://camping.tcs.ch/de/campingplatz-suche/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5_000); // let the static-query chunks finish loading
  const bodies = await Promise.all(sqBodies);
  await page.close();

  const slugs = new Set<string>();
  for (const body of bodies) {
    const campsites = (body as { data?: { allCampsites?: unknown[] } } | null)?.data
      ?.allCampsites;
    if (!Array.isArray(campsites)) continue;
    for (const c of campsites) {
      const slug = (c as { campingCareSlug?: unknown })?.campingCareSlug;
      if (typeof slug === 'string') slugs.add(slug);
    }
  }
  return [...slugs];
}

async function main(): Promise<void> {
  const table = loadExisting();
  const browser = await chromium.launch();

  const discovered = await discoverSlugsFromMarketingSite(browser).catch((err) => {
    console.warn(
      `[myCamp] Couldn't auto-discover slugs from camping.tcs.ch (falling back to the static ` +
        `candidate list only): ${(err as Error).message}`,
    );
    return [] as string[];
  });
  console.log(`[myCamp] discovered ${discovered.length} slug(s) from camping.tcs.ch.`);
  const candidateSlugs = [...new Set([...discovered, ...CAMPSITE_SLUG_CANDIDATES])];

  const page = await browser.newPage();
  let resolved = 0;
  let skipped = 0;

  for (const slug of candidateSlugs) {
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
