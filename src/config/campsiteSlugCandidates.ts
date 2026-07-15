/**
 * Candidate booking.camping.care slugs to probe when (re)building
 * src/config/campsites.json (see src/updateCampsites.ts).
 *
 * Seeded from https://camping.tcs.ch/sitemap-0.xml's /de/campingplaetze/{slug}/
 * entries. That marketing-site slug is NOT always the same as the booking
 * widget's slug — some of these resolve to booking.camping.care/not-found and
 * are silently skipped by the discovery script. If you know the correct
 * booking slug for one of those, add/replace it here by hand.
 */
export const CAMPSITE_SLUG_CANDIDATES: string[] = [
  'riverlodge',
  'tcs-camping-bern-eymatt',
  'tcs-camping-boenigen-brienzersee',
  'tcs-camping-buochs-vierwaldstaettersee',
  'tcs-camping-disentis',
  'tcs-camping-estavayer-la-nouvelle-plage',
  'tcs-camping-flaach-am-rhein',
  'tcs-camping-flims',
  'tcs-camping-geneve-vesenaz',
  'tcs-camping-gordevio-valle-maggia',
  'tcs-camping-gwatt-thunersee',
  'tcs-camping-interlaken',
  'tcs-camping-laax-pop-glamping',
  'tcs-camping-la-tene-lac-de-neuchatel',
  'tcs-camping-lugano-muzzano',
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
