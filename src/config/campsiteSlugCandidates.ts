/**
 * Fallback candidate booking.camping.care slugs, used only if
 * discoverSlugsFromMarketingSite() (see src/updateCampsites.ts) fails to
 * reach camping.tcs.ch's search page. That dynamic discovery is authoritative
 * — it reads campingCareSlug directly from camping.tcs.ch's own campsite
 * data — so this list exists purely as a safety net and doesn't need to be
 * kept in sync by hand.
 *
 * These are the verified-correct slugs (confirmed via the dynamic discovery
 * itself). Two are NOT simple transliterations of the campsite name —
 * "tcs-camping-bern-eymatt" and "tcs-camping-lugano-muzzano" (no suffix)
 * resolve to internal test duplicates, not the real campsite, so don't add
 * those back without the "1" suffix.
 */
export const CAMPSITE_SLUG_CANDIDATES: string[] = [
  'riverlodge',
  'tcs-camping-laax-pop-glamping',
  'tcs-camping-bern-eymatt1',
  'tcs-camping-bonigen-brienzersee',
  'tcs-camping-buochs-vierwaldstattersee',
  'tcs-camping-disentis',
  'tcs-camping-estavayer-le-lac',
  'tcs-camping-flaach-am-rhein',
  'tcs-camping-flims',
  'tcs-camping-genf-vesenaz',
  'tcs-camping-gordevio-maggiatal',
  'tcs-camping-gwatt-thunersee',
  'tcs-camping-interlaken',
  'tcs-camping-la-tene-neuenburgersee',
  'tcs-camping-lugano-muzzano1',
  'tcs-camping-luzern-horw',
  'tcs-camping-martigny',
  'tcs-camping-morges',
  'tcs-camping-olivone',
  'tcs-camping-orbe',
  'tcs-camping-salavaux-plage',
  'tcs-camping-samedan',
  'tcs-camping-scuol',
  'tcs-camping-sempach',
  'tcs-camping-sion',
  'tcs-camping-solothurn',
  'tcs-camping-thusis-viamala',
];
