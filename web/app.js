(() => {
  'use strict';

  const DATA_URL = './data/encrypted-history.json'; // relative → works on user and project Pages sites alike
  const GENERIC_FAIL = 'Couldn’t load data right now.'; // same message for every failure mode — no oracle

  const $ = (id) => document.getElementById(id);
  let matches = [];
  let sortMode = 'price';

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Mirrors src/crypto/decrypt.ts exactly: AES-GCM 256, raw base64 key,
  // blob shape { iv: base64, ciphertext: base64 }.
  async function decrypt(blob, base64Key) {
    const raw = b64ToBytes(base64Key);
    if (raw.length !== 32) throw new Error('bad key length');
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(blob.iv) },
      key,
      b64ToBytes(blob.ciphertext),
    );
    return new TextDecoder().decode(plainBuf);
  }

  const chf = new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };

  function render() {
    const grid = $('grid');
    // Unresolved locations ("Admin N…") surface first, regardless of sort
    // mode, so the ones needing a campsites.json entry are easy to spot.
    const sorted = [...matches].sort((a, b) => {
      const unresolvedDiff = (a.locationUrl ? 1 : 0) - (b.locationUrl ? 1 : 0);
      if (unresolvedDiff !== 0) return unresolvedDiff;
      return sortMode === 'price'
        ? a.priceTotal - b.priceTotal || a.arrival.localeCompare(b.arrival)
        : a.arrival.localeCompare(b.arrival) || a.priceTotal - b.priceTotal;
    });
    grid.replaceChildren(
      ...sorted.map((m) => {
        const row = document.createElement('tr');

        const location = document.createElement('td');
        const locationText = m.locationName ?? `Admin ${m.adminId}`;
        if (m.locationUrl) {
          const locLink = document.createElement('a');
          locLink.className = 'location-link';
          locLink.href = m.locationUrl;
          locLink.target = '_blank';
          locLink.rel = 'noopener noreferrer';
          locLink.textContent = locationText;
          location.append(locLink);
        } else {
          location.textContent = locationText;
        }

        const nameCell = document.createElement('td');
        nameCell.className = 'name-cell';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = m.name;
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = m.category;
        nameCell.append(nameSpan, document.createTextNode(' '), pill);

        const sleeps = document.createElement('td');
        sleeps.textContent = String(m.personsMax);

        const arrival = document.createElement('td');
        arrival.textContent = fmtDate(m.arrival);

        const departure = document.createElement('td');
        departure.textContent = fmtDate(m.departure);

        const nights = document.createElement('td');
        nights.textContent = String(m.durationNights);

        const price = document.createElement('td');
        price.className = 'price-cell';
        price.textContent = chf.format(m.priceTotal);
        const cur = document.createElement('small');
        cur.textContent = m.currency;
        price.append(cur);

        const bookCell = document.createElement('td');
        bookCell.className = 'book-cell';
        if (m.bookingUrl) {
          const link = document.createElement('a');
          link.className = 'book';
          link.href = m.bookingUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = new URL(m.bookingUrl).pathname;
          bookCell.append(link);
        } else {
          const span = document.createElement('span');
          span.className = 'book-unavailable';
          span.textContent = 'link unavailable';
          bookCell.append(span);
        }

        row.append(location, nameCell, sleeps, arrival, departure, nights, price, bookCell);
        return row;
      }),
    );
    $('emptyMsg').hidden = matches.length > 0;
    const newest = matches.reduce((acc, m) => (m.scrapedAt > acc ? m.scrapedAt : acc), '');
    $('summary').textContent =
      `${matches.length} match${matches.length === 1 ? '' : 'es'}` +
      (newest ? ` · last updated ${fmtDate(newest.slice(0, 10))}` : '');
  }

  async function tryUnlock(rawKey) {
    const key = rawKey.trim();
    if (!key) return;
    const notice = $('notice');
    notice.textContent = '';
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const text = (await res.text()).trim();
      if (!text) throw new Error('no data yet');
      const blob = JSON.parse(text);
      const history = JSON.parse(await decrypt(blob, key));
      matches = Array.isArray(history.matches) ? history.matches : [];
      $('locked').hidden = true;
      document.querySelector('main').classList.add('wide');
      const dash = $('dash');
      dash.classList.add('open');
      dash.setAttribute('aria-hidden', 'false');
      render();
    } catch {
      // Quiet + generic on purpose: wrong key, malformed key, missing file and
      // network errors all look identical — nothing useful for a passer-by.
      notice.textContent = GENERIC_FAIL;
    }
  }

  $('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    tryUnlock($('keyField').value);
  });

  document.querySelectorAll('.controls button').forEach((btn) => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.sort;
      document
        .querySelectorAll('.controls button')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    });
  });
})();
