# myCamp

myCamp automatically searches TCS Camping (Switzerland) every day for available static-accommodation stays (pods, cabins, tents-not-required) that fit your family's size, travel window and preferred arrival weekdays. Results accumulate in an **encrypted** JSON file committed to this public repo, and a static dashboard on GitHub Pages renders them — but only for someone holding the current decryption key, which rotates automatically every week.

## How it works

- **Daily** (`daily-scrape.yml`, 06:00 UTC): queries `api.camping.care/v3/accommodations/search` for every candidate `(arrival, duration)` window, filters by category denylist and family capacity, merges new matches into the history, re-encrypts it with the current key and commits `data/encrypted-history.json`.
- **Weekly** (`weekly-rotate.yml`, Monday 03:00 UTC): runs the same scrape, then generates a fresh 256-bit AES key, updates the repo variable via the GitHub API, and re-encrypts the full history with the new key.
- **Dashboard** (`web/index.html`, deployed by `deploy-pages.yml`): a single self-contained page. Paste the current key into the input field (disguised as a newsletter email field) to decrypt and browse results.

## One-time setup

### 1. Generate the initial encryption key

```bash
npm ci
npm run init-key   # prints a base64 256-bit key — run locally, never in CI
```

### 2. Configure Actions variables and secrets

Settings → Secrets and variables → Actions.

**Variables tab** (readable back out by you — that's the point):

| Variable                | Value               |
| ----------------------- | ------------------- |
| `MYCAMP_ENCRYPTION_KEY` | the key from step 1 |

**Secrets tab**:

| Secret                     | Meaning                                                    | Example      |
| -------------------------- | ---------------------------------------------------------- | ------------ |
| `MYCAMP_ADULTS`            | number of adults                                           | `3`          |
| `MYCAMP_CHILDREN_AGES`     | children's ages, comma-separated (empty = none)            | `8,14`       |
| `MYCAMP_SEARCH_START_DATE` | first arrival date to consider (omit = today)              | `2026-09-01` |
| `MYCAMP_SEARCH_END_DATE`   | last arrival date, inclusive                               | `2026-09-20` |
| `MYCAMP_STAY_DURATIONS`    | stay lengths in nights, comma-separated                    | `3,4`        |
| `MYCAMP_ARRIVAL_WEEKDAYS`  | ISO weekdays for arrivals (1=Mon … 7=Sun), comma-separated | `6,7`        |
| `MYCAMP_VARS_PAT`          | fine-grained PAT for the rotation job (step 3)             | —            |

Any value you don't set falls back to the generic defaults in `conditions.json` (which deliberately contains **no personal data** — do not put your real family details in it).

**Why this split?**

- The **encryption key** goes in a _variable_, not a secret, on purpose: the whole design relies on you being able to read it back out (Variables tab or API) to paste into the dashboard. Repo variables on a public repo are readable only by collaborators with repo access, not by the public.
- The **family config** goes in _secrets_: children's ages and family composition are personal data. Mechanically both arrive via the same `env:` block, but secrets are masked in logs and never listed readably in the Settings UI — variables are.

### 3. Create the PAT for weekly key rotation

The rotation job needs permission to update the `MYCAMP_ENCRYPTION_KEY` variable:

1. GitHub → Settings (your account) → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Resource owner: you. Repository access: **Only select repositories** → this repo.
3. Permissions → Repository permissions → **Variables: Read and write**. Nothing else.
4. Copy the token and store it as the repo secret `MYCAMP_VARS_PAT`.
5. Set a long expiry or calendar-remind yourself to renew it — if it expires, the weekly rotation fails (loudly, before touching any data).

### 4. Enable GitHub Pages

Settings → Pages → Build and deployment → Source: **GitHub Actions**. (One-time manual step — the `deploy-pages.yml` workflow can't publish until Pages is switched on.) Then run _Deploy dashboard to GitHub Pages_ once via the Actions tab → workflow_dispatch.

GitHub Pages is free for public repos (1 GB site, 100 GB/month bandwidth — this project uses a rounding error of that).

### 5. Use the dashboard

- URL: `https://{owner}.github.io/{repo}/`
- Current key: Settings → Secrets and variables → Actions → **Variables** tab → `MYCAMP_ENCRYPTION_KEY`.
- Paste it into the input field on the page (yes, the one labeled like an email signup) and submit.

The key rotates every Monday, so re-fetch it from the Variables tab after each rotation.

## Recovery

If a rotation is interrupted at exactly the wrong moment (variable updated but the push failed), the daily job will refuse to decrypt and fail loudly rather than wiping your history. To accept the loss and start fresh: Actions → _Daily scrape_ → Run workflow → set `reset_history` to `1`.

## Development

```bash
npm ci
npm test          # vitest: date windows, conditions merge, crypto round-trip, API quirks, dedupe
npm run typecheck
npm run lint
npm run scrape    # needs MYCAMP_ENCRYPTION_KEY in the environment

# One-off manual query against the live API — no encryption key, no history file.
# Driven by the same MYCAMP_* variables as the real scrape (falling back to
# conditions.json for anything not set); prints raw vs. filtered counts per window.
MYCAMP_ADULTS=2 MYCAMP_CHILDREN_AGES=2,5 \
MYCAMP_SEARCH_START_DATE=2026-09-01 MYCAMP_SEARCH_END_DATE=2026-09-07 \
MYCAMP_ARRIVAL_WEEKDAYS=1,2,3,4,5 MYCAMP_STAY_DURATIONS=6 \
npm run debug-search
```

Notable implementation details (see code comments for the full story):

- **API quirks handled defensively** (`src/api/campingCare.ts`): no `offset` pagination (unreliable) — one big `limit=500` request with a loud truncation warning if the response length hits the limit exactly; an optimistic `young_children` age split with automatic fallback to a lumped `children` bucket (and a warning to manually verify the youngest child's pricing); campsite ids extracted from thumbnail URLs; category filtering via **denylist** so new accommodation types appear by default; each result's `id` field is an opaque string (`"acc_..."`) — the real numeric accommodation id used for booking urls is the separate `numeric_id` field.
- The API token in `campingCare.ts` is camping.care's **publishable** (`pub_…`) key as served to every visitor of `camping.tcs.ch` — recapture it via browser devtools (Network tab on the TCS campsite search, filter `accommodations/search`) if it's ever rotated.
- Minimum accommodation capacity is always **derived** (`adults + children.length`) — there is intentionally no config field for it.
- Crypto is Web Crypto AES-GCM-256 on both sides (Node ≥19 and the browser share the exact same blob shape: `{ iv, ciphertext }`, fresh random IV per write).

## Security model — honest version

This protects the family's travel plans from **casual/anonymous visitors and search engines**: the committed data is AES-GCM ciphertext, the dashboard leaks nothing without the key, and the key lives in a repo variable readable only by authenticated collaborators.

It does **not** protect against a targeted attacker who gains repo access (they can read the variable), nor against the platform operator (GitHub can see the variable). Key rotation limits the window in which a leaked key stays useful; it is hygiene, not cryptographic secrecy from GitHub itself.

## Out of scope

No booking automation (read-only discovery), no notifications, no SQLite (the dataset is tiny; the storage layer is isolated in `src/storage/history.ts` if that ever changes).
