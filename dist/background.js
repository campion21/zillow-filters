/**
 * Service worker: settings store, verdict cache, throttled same-origin fetcher.
 * Keeps Zillow traffic human-shaped: max 2 concurrent, ≥700ms between starts,
 * jittered; cache TTL 7 days so repeat browsing is free.
 */
import { FILTERS } from '../shared/detector.js';

const DEFAULTS = {
  enabledFilters: FILTERS.filter((f) => f.defaultOn).map((f) => f.id),
  mode: 'tag',            // 'tag' | 'hide'
  showConcerns: true,
};
const CACHE_PREFIX = 'verdict:';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const CACHE_MAX_ENTRIES = 350;

/** Evict expired entries, then oldest-first if still over cap. */
async function evictCache() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(CACHE_PREFIX))
    .map(([k, v]) => [k, v?.t ?? 0]);
  const stale = entries.filter(([, t]) => Date.now() - t > CACHE_TTL_MS).map(([k]) => k);
  let live = entries.filter(([, t]) => Date.now() - t <= CACHE_TTL_MS);
  const over = live.length - CACHE_MAX_ENTRIES;
  const extra = over > 0 ? live.sort((a, b) => a[1] - b[1]).slice(0, over).map(([k]) => k) : [];
  if (stale.length || extra.length) await chrome.storage.local.remove([...stale, ...extra]);
}

/* ---------------- settings ---------------- */

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}
async function setSettings(patch) {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: { ...s, ...patch } });
}

/* ---------------- verdict cache ---------------- */

async function getCached(zpid) {
  const key = CACHE_PREFIX + zpid;
  const { [key]: entry } = await chrome.storage.local.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL_MS) return null;
  return entry.v;
}
async function setCached(zpid, verdict) {
  await evictCache();
  await chrome.storage.local.set({ [CACHE_PREFIX + zpid]: { t: Date.now(), v: verdict } });
}

/* ---------------- rate-limited fetch queue ---------------- */

const MIN_GAP_MS = 700;
let active = 0, lastStart = 0;
const queue = [];

function pump() {
  while (active < 2 && queue.length) {
    const since = Date.now() - lastStart;
    if (since < MIN_GAP_MS) { setTimeout(pump, MIN_GAP_MS - since + Math.random() * 400); return; }
    const job = queue.shift();
    active++; lastStart = Date.now();
    job.run()
      .then(job.resolve, job.reject)
      .finally(() => { active--; setTimeout(pump, 200 + Math.random() * 300); });
  }
}
function enqueue(run) {
  return new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); pump(); });
}

async function throttledText(url) {
  return enqueue(async () => {
    const resp = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (resp.status === 403 || resp.status === 429) throw new Error(`zpf-blocked-${resp.status}`);
    if (!resp.ok) throw new Error(`zpf-http-${resp.status}`);
    return resp.text();
  });
}

/* ---------------- message surface ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'get-settings': return sendResponse(await getSettings());
      case 'set-settings': {
        await setSettings(msg.patch);
        const tabs = await chrome.tabs.query({ url: '*://www.zillow.com/*' });
        for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'zpf-settings' }).catch(() => {});
        return sendResponse(await getSettings());
      }
      case 'fetch-listing': {
        const cached = await getCached(msg.zpid);
        if (cached) return sendResponse(cached);
        try {
          const text = await throttledText(msg.url);
          // Cache raw HTML keyed by zpid (7-day TTL) — content script parses.
          const payload = { ok: true, html: text };
          await setCached(msg.zpid, payload); // ~1-3MB pages; eviction task covers growth
          return sendResponse(payload);
        } catch (e) {
          return sendResponse({ ok: false, error: String(e.message || e) });
        }
      }
      case 'cache-verdict': return setCached(msg.zpid, msg.verdict).then(() => sendResponse(true));
      default: return sendResponse(null);
    }
  })();
  return true; // async sendResponse
});
