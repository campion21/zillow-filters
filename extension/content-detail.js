/**
 * Zillow Power Filters — detail-page banner.
 * Plain script; detector globals provided by detector-global.js (window.ZPF).
 * Reads this page's own __NEXT_DATA__ — zero network requests.
 */
(function () {
  'use strict';
  if (window.__zpfDetailRunning) return;
  window.__zpfDetailRunning = true;

  const { FILTER_MAP, evaluateAll, detectConcerns, fromZillowProperty } = window.ZPF;

  function parseNextData(doc) {
    const text = doc.querySelector('script#__NEXT_DATA__')?.textContent;
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
      } catch { /* fall through */ }
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

  async function main() {
    let settings;
    try {
      settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
    } catch {
      settings = { enabledFilters: ['gasRange'], showConcerns: true };
    }

    const data = parseNextData(document);
    const prop = data ? findProperty(data) : null;
    let listing = fromZillowProperty(prop);

    // Fallback: visible description text
    if (!listing.resoFacts) {
      const d = document.querySelector('[data-testid="home-description-text"], .ds-overview-notes, [class*="description"]');
      if (d) listing = { ...listing, description: d.textContent };
    }

    const verdicts = evaluateAll(listing, settings.enabledFilters);
    const concerns = settings.showConcerns ? detectConcerns(listing) : [];

    const banner = document.createElement('div');
    banner.className = 'zpf-banner';
    const h = document.createElement('h4');
    h.textContent = prop ? 'Power Filters' : 'Power Filters (no structured data on this page)';
    banner.append(h);

    const row = document.createElement('div');
    row.className = 'zpf-row';
    for (const id of Object.keys(verdicts)) {
      const f = FILTER_MAP[id]; const v = verdicts[id];
      const el = document.createElement('span');
      el.className = `zpf-chip zpf-${v.status === 'unknown' ? 'unknown' : v.status}`;
      el.textContent = `${f.icon} ${f.label}: ${v.status === 'yes' ? '✓' : v.status === 'no' ? '✗' : '?'}`;
      el.title = v.matched?.length ? `${v.source}: ${v.matched.join(', ')}` : `${v.status} (no evidence surfaced)`;
      row.append(el);
    }
    for (const c of concerns) {
      const el = document.createElement('span');
      el.className = 'zpf-chip zpf-concern';
      el.textContent = `⚠ ${c.label}`;
      el.title = `“${c.matched}”`;
      row.append(el);
    }
    banner.append(row);

    const anchor =
      document.querySelector('[data-testid="home-details-chip-bed-bath"]')?.closest('div') ||
      document.querySelector('h1');
    if (anchor) anchor.insertAdjacentElement('beforebegin', banner);
    else document.body.prepend(banner);
    console.log('[ZPF] banner injected', { propFound: !!prop, verdicts });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
