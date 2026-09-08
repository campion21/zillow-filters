/**
 * Zillow Power Filters — search-page enrichment.
 * Plain script (no imports): everything needed is inlined below or provided
 * by detector-global.js, which loads first and sets window.ZPF.
 * Unknowns are never treated as failures; only 'no' hides (in hide mode).
 */
(function () {
  'use strict';
  if (window.__zpfRunning) return;
  window.__zpfRunning = true;

  if (!window.ZPF || !window.ZPF.FILTERS) {
    const box = document.createElement('div');
    box.id = 'zpf-status';
    box.textContent = 'ZPF ERROR: detector-global.js did not load — window.ZPF missing';
    document.body?.append(box) || document.documentElement.append(box);
    console.error('[ZPF] window.ZPF missing — check that detector-global.js loads before content-search.js', window.ZPF);
    return;
  }
  const { FILTERS, evaluateAll, detectConcerns, fromZillowProperty } = window.ZPF;
  const FILTER_MAP = Object.fromEntries(FILTERS.map((f) => [f.id, f]));

  /* ---------------------------------------------------------- diagnostics */
  function statusBox(msg, color) {
    let box = document.getElementById('zpf-status');
    if (!box) {
      box = document.createElement('div');
      box.id = 'zpf-status';
      box.style.cssText = `position:fixed;bottom:12px;left:50%;transform:translateX(-50%);
        background:#fff;border:2px solid #3560b8;border-radius:999px;padding:6px 14px;
        font:600 12px -apple-system,sans-serif;color:#333;z-index:999999;
        box-shadow:0 2px 12px rgba(0,0,0,.25);pointer-events:none;`;
      (document.body || document.documentElement).append(box);
    }
    box.textContent = 'ZPF: ' + msg;
    box.style.borderColor = color;
    console.log('[ZPF]', msg);
  }

  /* ------------------------------------------------------- JSON adapters */
  function parseNextData(source) {
    let text = null;
    if (typeof source === 'string') {
      const m = source.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (m) text = m[1];
    } else {
      text = source.querySelector?.('script#__NEXT_DATA__')?.textContent ?? null;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  function looksLikeProperty(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    return !!(x.resoFacts && (x.zpid || x.streetAddress || x.address || x.description));
  }

  function findProperty(obj, depth = 0) {
    if (!obj || depth > 14) return null;
    const gdp = obj?.props?.pageProps?.componentProps?.gdpClientCache;
    if (typeof gdp === 'string') {
      try {
        const cache = JSON.parse(gdp);
        for (const k of Object.keys(cache)) {
          const p = cache[k]?.property ?? cache[k]?.data?.property;
          if (p && looksLikeProperty(p)) return p;
        }
        for (const k of Object.keys(cache)) {
          const hit = findProperty(cache[k], depth + 1);
          if (hit) return hit;
        }
      } catch { /* fall through to generic walk */ }
    }
    if (looksLikeProperty(obj)) return obj;
    if (typeof obj !== 'object') return null;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const hit = findProperty(v, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  /* ------------------------------------------------------- card adapters */
  function cardInfo(card) {
    let zpid = card.dataset?.zpid || card.getAttribute?.('data-zpid') || null;
    const a = card.querySelector?.('a[href*="/homedetails/"]');
    let detailUrl = null;
    if (a) {
      detailUrl = a.getAttribute('href');
      if (detailUrl?.startsWith('/')) detailUrl = location.origin + detailUrl;
    }
    if (!zpid && detailUrl) {
      const m = detailUrl.match(/\/(\d+)_zpid\//);
      if (m) zpid = m[1];
    }
    return zpid ? { zpid, detailUrl } : (detailUrl ? { zpid: null, detailUrl } : null);
  }

  /* -------------------------------------------------------------- state */
  const processed = new WeakSet();
  const results = new Map();
  let settings = null;

  async function refreshSettings() {
    try {
      settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
    } catch (e) {
      // storage unreachable → run with hardcoded defaults so the user still gets feedback
      settings = { enabledFilters: ['gasRange'], mode: 'tag', showConcerns: true };
      statusBox('settings unavailable, using defaults — ' + e.message, 'orange');
    }
    reapplyAll();
  }
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'zpf-settings') refreshSettings(); });

  /* ------------------------------------------------------------- DOM out */
  function ensureRow(card) {
    let row = card.querySelector(':scope > .zpf-badge-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'zpf-badge-row';
      card.prepend(row);
    }
    return row;
  }

  function chip(filter, v) {
    const el = document.createElement('span');
    el.className = `zpf-chip zpf-${v.status === 'unknown' ? 'unknown' : v.status}`;
    const mk = v.status === 'yes' ? '✓' : v.status === 'no' ? '✗' : '?';
    el.textContent = `${filter.icon} ${mk}`;
    el.title = `${filter.label}: ${v.status}` + (v.matched?.length ? ` — ${v.matched.join(', ')}` : '');
    return el;
  }
  function concernChip(c) {
    const el = document.createElement('span');
    el.className = 'zpf-chip zpf-concern';
    el.textContent = `⚠ ${c.label}`;
    el.title = `Red flag (from listing text): “${c.matched}”`;
    return el;
  }

  function paint(card, res) {
    const row = ensureRow(card);
    row.replaceChildren();
    results.set(card, res);
    for (const id of settings.enabledFilters) {
      const f = FILTER_MAP[id]; const v = res.verdicts[id];
      if (f && v) row.append(chip(f, v));
    }
    for (const c of res.concerns) row.append(concernChip(c));
    const failed = settings.enabledFilters.some((id) => res.verdicts[id]?.status === 'no');
    card.classList.toggle('zpf-hidden-card', failed && settings.mode === 'hide');
  }

  function reapplyAll() {
    for (const [card, res] of results) if (card.isConnected) paint(card, res);
  }

  /* -------------------------------------------------------- data fetch */
  async function resolveListing(info) {
    if (!info.detailUrl) return { error: 'no detail URL' };
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'fetch-listing', zpid: info.zpid, url: info.detailUrl });
    } catch (e) {
      return { error: 'messaging: ' + e.message };
    }
    if (!resp?.ok) return { error: resp?.error || 'unknown' };
    const data = parseNextData(resp.html);
    if (!data) return { error: 'no __NEXT_DATA__ in detail page' };
    const prop = findProperty(data);
    if (!prop) return { error: 'property record not found in JSON' };
    return { listing: fromZillowProperty(prop) };
  }

  async function processCard(card) {
    if (processed.has(card) || !settings) return;
    processed.add(card);
    const info = cardInfo(card);
    const row = ensureRow(card);
    const pend = document.createElement('span');
    pend.className = 'zpf-chip zpf-loading';
    pend.textContent = '⏳ ZPF';
    pend.title = 'Zillow Power Filters: fetching listing details…';
    row.append(pend);

    const { listing, error } = await resolveListing(info || {});
    if (error || !listing) {
      pend.textContent = '⏳?';
      pend.title = 'ZPF could not read this listing: ' + (error || 'no data');
      return;
    }
    const verdicts = evaluateAll(listing, settings.enabledFilters);
    const concerns = settings.showConcerns ? detectConcerns(listing) : [];
    paint(card, { verdicts, concerns });
  }

  /* -------------------------------------------------------- scanning */
  const CARD_SEL = [
    'article[data-test="property-card"]',
    'article[data-testid="property-card"]',
    '[data-test="property-card"]',
    '[data-testid="property-card"]',
    'li[class^="ListItem"] article',
  ].join(', ');

  let scanTimer = null;
  function scan() {
    const cards = document.querySelectorAll(CARD_SEL);
    statusBox(`scan — ${cards.length} card element(s) found`, cards.length ? '#14703c' : '#b3261e');
    cards.forEach(processCard);
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300); // debounce
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    if (!document.body) { setTimeout(boot, 200); return; }
    statusBox('script loaded, booting…', '#3560b8');
    refreshSettings().then(() => {
      scan();
      const mo = new MutationObserver(scheduleScan);
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
  boot();
})();
