/** Effective search conditions after merging conditions.json with env overrides. */
export interface Conditions {
  adults: number;
  /** Ages of children, in years. Length of this array = number of children. */
  children: number[];
  /** ISO date (YYYY-MM-DD) or null meaning "today". */
  searchStartDate: string | null;
  /** ISO date (YYYY-MM-DD), inclusive. */
  searchEndDate: string;
  /** Stay lengths to query, in nights. */
  stayDurations: number[];
  /** ISO weekday numbers (1 = Monday … 7 = Sunday) on which arrivals are allowed. */
  arrivalWeekdays: number[];
  /**
   * Denylist of accommodation categories. New/unseen categories are included
   * by default (see §4.2 quirk 3 of the spec).
   */
  excludedCategories: string[];
}

/** One matching accommodation/stay combination. */
export interface CampMatch {
  scrapedAt: string; // ISO timestamp
  adminId: string;
  accommodationId: number;
  name: string; // e.g. "Family Pod"
  category: string;
  personsMax: number;
  arrival: string; // YYYY-MM-DD
  departure: string; // YYYY-MM-DD
  durationNights: number;
  priceTotal: number;
  currency: 'CHF';
  bookingUrl: string;
}

/** Plaintext shape of data/encrypted-history.json once decrypted. */
export interface HistoryFile {
  /** Increments on each key rotation — for debugging/sanity only. */
  keyVersion: number;
  matches: CampMatch[];
}

/** One candidate (arrival, duration) query window. */
export interface DateWindow {
  arrival: string; // YYYY-MM-DD
  departure: string; // YYYY-MM-DD
  durationNights: number;
}
