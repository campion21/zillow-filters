/**
 * Search-page enrichment: badge each result card with enabled-filter verdicts.
 * Data sources in priority order:
 *   1. background cache (free)
 *   2. throttled fetch of the card's detail URL → parse its __NEXT_DATA__
 * Unknown is never treated as fail; only explicit 'no' hides (in hide mode).
 */
import { FILTER_MAP, evaluateAll, detectConcerns, fromZillowProperty } from '../shared/detector.js';
import { parseNextData, findProperty, cardInfo } from './zillow-extract.js';

const processed = new WeakSet();
let settings = null;

/* ---------------- settings ---------------- */

async function refreshSettings() {
  settings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  reapplyAll();
}
chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'zpf-settings') refreshSettings(); });

/* ---------------- verdict resolution ---------------- */

async function resolveListing(info) {
  const props = await chrome.runtime.sendMessage({ type: 'fetch-listing', zpid: info.zpid, url: info.detailUrl });
  if (!props?.ok) return { error: props?.error || 'unknown' };
  const data = parseNextData(props.html);
  const prop = data ? findProperty(data) : null;
  return { listing: fromZillowProperty(prop) };
}

function evaluateForCard(listing) {
  const verdicts = evaluateAll(listing, settings.enabledFilters);
  const concerns = settings.showConcerns ? detectConcerns(listing) : [];
  return { verdicts, concerns };
}

function cardState({ verdicts }) {
  const fails = settings.enabledFilters.filter((id) => verdicts[id]?.status === 'no');
  const loading = false;
  return fails.length ? 'fail' : loading ? 'loading' : 'pass';
}

/* ---------------- DOM ---------------- */

function ensureRow(card) {
  let row = card.querySelector(':scope > .zpf-badge-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'zpf-badge-row';
    // Insert near card top but inside the card element itself.
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

async function processCard(card) {
  if (processed.has(card) || !settings) return;
  processed.add(card);
  const info = cardInfo(card);
  if (!info?.detailUrl) return;

  ensureRow(card); // reserve layout immediately

  const { listing, error } = await resolveListing(info);
  if (error || !listing) {
    const row = ensureRow(card);
    const el = document.createElement('span');
    el.className = 'zpf-chip zpf-loading';
    el.textContent = '⏳';
    el.title = error || 'no data';
    row.append(el);
    return;
  }

  const res = evaluateForCard(listing);
  paint(card, res);
}

function paint(card, { verdicts, concerns }) {
  const row = ensureRow(card);
  row.replaceChildren();
  for (const id of settings.enabledFilters) {
    const f = FILTER_MAP[id]; const v = verdicts[id];
    if (f && v) row.append(chip(f, v));
  }
  for (const c of concerns) row.append(concernChip(c));

  const failed = cardState({ verdicts }) === 'fail';
  card.classList.toggle('zpf-hidden-card', failed && settings.mode === 'hide');
}

/** Re-apply hide/show without re-fetching (settings toggles). */
const results = new Map(); // card → res
function reapplyAll() {
  for (const [card, res] of results) if (card.isConnected) paint(card, res);
}
const origPaint = paint;
paint = (card, res) => { results.set(card, res); origPaint(card, res); };

/* ---------------- scan & observe ---------------- */

function scan() {
  if (!settings) return;
  document.querySelectorAll(
    '[data-zpid], [data-test="property-card"], li[class*="ListItem"], article[data-zpid]'
  ).forEach(processCard);
}

const mo = new MutationObserver(() => scan());
refreshSettings().then(() => {
  scan();
  mo.observe(document.body, { childList: true, subtree: true });
});
