/**
 * Detail-page banner: shows every enabled filter verdict + concerns
 * using the full resoFacts embedded in this page — no fetch needed.
 */
import { FILTER_MAP, evaluateAll, detectConcerns, fromZillowProperty } from '../shared/detector.js';
import { parseNextData, findProperty } from './zillow-extract.js';

async function main() {
  const settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  const data = parseNextData(document);
  const prop = data ? findProperty(data) : null;

  let listing = fromZillowProperty(prop);
  // Fallback: scrape the visible "Facts & features" section
  if (!listing.resoFacts) {
    const descNode = document.querySelector('[data-testid="home-description-text"], .ds-overview-notes, [class*="description"]');
    if (descNode) listing = { ...listing, description: descNode.textContent };
  }

  const verdicts = evaluateAll(listing, settings.enabledFilters);
  const concerns = settings.showConcerns ? detectConcerns(listing) : [];

  const banner = document.createElement('div');
  banner.className = 'zpf-banner';
  const h = document.createElement('h4');
  h.textContent = 'Power Filters';
  const row = document.createElement('div');
  row.className = 'zpf-row';
  for (const id of Object.keys(verdicts)) {
    const f = FILTER_MAP[id]; const v = verdicts[id];
    const el = document.createElement('span');
    el.className = `zpf-chip zpf-${v.status === 'unknown' ? 'unknown' : v.status}`;
    el.textContent = `${f.icon} ${f.label}: ${v.status === 'yes' ? '✓' : v.status === 'no' ? '✗' : '?'}`;
    el.title = v.matched?.join(', ') || '';
    row.append(el);
  }
  for (const c of concerns) {
    const el = document.createElement('span');
    el.className = 'zpf-chip zpf-concern';
    el.textContent = `⚠ ${c.label}`;
    el.title = `“${c.matched}”`;
    row.append(el);
  }
  banner.append(h, row);

  const anchor =
    document.querySelector('[data-testid="home-details-chip-bed-bath"]')?.closest('div') ||
    document.querySelector('h1')?.parentElement ||
    document.body.firstElementChild;
  anchor?.parentElement?.insertBefore(banner, anchor.nextSibling) || document.body.prepend(banner);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else main();
