import { generateKeyBase64 } from './crypto/encrypt.js';
import { readHistory, writeHistory } from './storage/history.js';
import { requireKey, runScrape } from './scrape.js';

/**
 * Weekly rotation:
 *  1. Decrypt existing history with the CURRENT key (from the repo variable).
 *  2. Scrape (reusing the exact same logic as the daily job — deliberate, so
 *     rotation day's data isn't lost or duplicated across two separate runs).
 *  3. Generate a fresh random 256-bit key.
 *  4. Update the repo variable via the GitHub REST API FIRST…
 *  5. …then re-encrypt with the new key and write the file (committed by the
 *     workflow). Ordering rationale: the API call is the most likely failure
 *     point (expired PAT); failing there BEFORE touching the file leaves
 *     everything consistent. If instead the later git push fails, the variable
 *     already points at the new key while the committed file still uses the
 *     old one — recoverable via MYCAMP_RESET_HISTORY=1 (see storage/history.ts).
 */

async function updateRepoVariable(newKey: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo", provided by Actions
  const pat = process.env.MYCAMP_VARS_PAT;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set (are we running in GitHub Actions?)');
  if (!pat) {
    throw new Error(
      'MYCAMP_VARS_PAT is not set. Create a fine-grained PAT scoped to this repo with ' +
        '"Variables: Read and write" and store it as a repo SECRET named MYCAMP_VARS_PAT (see README).',
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/variables/MYCAMP_ENCRYPTION_KEY`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'MYCAMP_ENCRYPTION_KEY', value: newKey }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Failed to update repo variable MYCAMP_ENCRYPTION_KEY: HTTP ${res.status} ${body}`,
    );
  }
}

async function main(): Promise<void> {
  const currentKey = requireKey();

  // 1–2: decrypt with current key, then scrape today's data into it.
  const history = await readHistory(currentKey);
  const updated = await runScrape(history);

  // 3: fresh key; bump keyVersion (debugging/sanity only).
  const newKey = generateKeyBase64();
  updated.keyVersion = (updated.keyVersion ?? 0) + 1;

  // 4: point the repo variable at the new key before rewriting the file.
  await updateRepoVariable(newKey);
  console.log(`[myCamp] Repo variable updated. keyVersion is now ${updated.keyVersion}.`);

  // 5: re-encrypt the FULL history with the new key.
  await writeHistory(updated, newKey);
  console.log('[myCamp] History re-encrypted with the new key. Workflow will commit the file.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
