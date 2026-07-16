import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encrypt, type EncryptedBlob } from '../crypto/encrypt.js';
import { decrypt } from '../crypto/decrypt.js';
import type { CampMatch, HistoryFile } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HISTORY_PATH = path.resolve(here, '../../data/encrypted-history.json');

export function emptyHistory(): HistoryFile {
  return { keyVersion: 1, matches: [] };
}

/**
 * Read and decrypt the committed history. First-run friendly: a missing or
 * empty file yields an empty history. A present-but-undecryptable file throws
 * (we refuse to silently wipe history on a wrong key), unless
 * MYCAMP_RESET_HISTORY=1 is set — the documented escape hatch if the key and
 * ciphertext ever get out of sync (e.g. a partially-failed rotation).
 */
export async function readHistory(
  base64Key: string,
  filePath: string = HISTORY_PATH,
  env: Record<string, string | undefined> = process.env,
): Promise<HistoryFile> {
  if (!existsSync(filePath)) return emptyHistory();
  const raw = readFileSync(filePath, 'utf8').trim();
  if (raw.length === 0) return emptyHistory();

  try {
    const blob = JSON.parse(raw) as EncryptedBlob;
    const plaintext = await decrypt(blob, base64Key);
    return JSON.parse(plaintext) as HistoryFile;
  } catch (err) {
    if (env.MYCAMP_RESET_HISTORY === '1') {
      console.warn(
        '[myCamp] MYCAMP_RESET_HISTORY=1 set — starting a FRESH history (old data discarded).',
      );
      return emptyHistory();
    }
    throw new Error(
      'Failed to decrypt data/encrypted-history.json with the current key. Refusing to overwrite it. ' +
        'If the key was rotated out from under this file, re-run with MYCAMP_RESET_HISTORY=1 to start fresh. ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

export function dedupeKey(
  m: Pick<CampMatch, 'adminId' | 'accommodationId' | 'arrival' | 'durationNights'>,
): string {
  return `${m.adminId}|${m.accommodationId}|${m.arrival}|${m.durationNights}`;
}

function windowKey(m: Pick<CampMatch, 'arrival' | 'durationNights'>): string {
  return `${m.arrival}|${m.durationNights}`;
}

/**
 * Merge freshly-scraped matches into the history. Dedupe on
 * adminId+accommodationId+arrival+durationNights; on conflict keep the most
 * recent priceTotal/scrapedAt (i.e. the new match wins those fields).
 *
 * `searchedWindows` is the full set of (arrival, duration) windows this run
 * queried (i.e. `generateDateWindows(conditions)`), not just the ones with
 * results. An existing match whose window was actively searched this run but
 * didn't come back in `fresh` is dropped — it's confirmed gone (sold out,
 * removed), not merely unchecked. A match whose window falls outside what
 * was searched this run (e.g. the search window has since narrowed) is left
 * untouched, since we have no fresh information about it either way.
 */
export function mergeMatches(
  history: HistoryFile,
  fresh: CampMatch[],
  searchedWindows: Pick<CampMatch, 'arrival' | 'durationNights'>[],
): HistoryFile {
  const searchedKeys = new Set(searchedWindows.map(windowKey));
  const byKey = new Map<string, CampMatch>();

  for (const m of history.matches) {
    if (searchedKeys.has(windowKey(m))) continue; // only survives below if still present in `fresh`
    byKey.set(dedupeKey(m), m);
  }
  for (const m of fresh) {
    const key = dedupeKey(m);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...m } : m);
  }
  return { ...history, matches: [...byKey.values()] };
}

/** Encrypt the full history with the given key and write it to disk (ciphertext only, never plaintext). */
export async function writeHistory(
  history: HistoryFile,
  base64Key: string,
  filePath: string = HISTORY_PATH,
): Promise<void> {
  const blob = await encrypt(JSON.stringify(history), base64Key);
  writeFileSync(filePath, `${JSON.stringify(blob, null, 2)}\n`, 'utf8');
}
