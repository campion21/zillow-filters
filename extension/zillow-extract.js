/**
 * Adapters between Zillow's page-embedded JSON and the detector's input.
 * Centralizes every Zillow-internal path — when Zillow reshapes their
 * payload, fixes live here only.
 */

/** Parse the <script id="__NEXT_DATA__"> blob from a Document or HTML string. */
export function parseNextData(source) {
  let text = null;
  if (typeof source === 'string') {
    const m = source.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (m) text = m[1];
  } else if (source?.querySelector) {
    text = source.querySelector('script#__NEXT_DATA__')?.textContent ?? null;
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Depth-first search for an object that looks like a Zillow property record.
 *  Path-shaped first (fast), generic walk as fallback (robust). */
export function findProperty(obj, depth = 0) {
  if (!obj || depth > 14) return null;

  // Known fast path: gdpClientCache is a JSON *string* keyed by query hash.
  const gdp = obj?.props?.pageProps?.componentProps?.gdpClientCache;
  if (typeof gdp === 'string') {
    try {
      const cache = JSON.parse(gdp);
      for (const k of Object.keys(cache)) {
        const p = cache[k]?.property ?? cache[k]?.data?.property;
        if (p && looksLikeProperty(p)) return p;
      }
      // Some variants nest the property a level deeper — walk whole cache.
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

function looksLikeProperty(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  // A property record carries resoFacts AND at least one identity field.
  if (x.resoFacts && (x.zpid || x.streetAddress || x.address)) return true;
  // Rentals variant: building-level record with resoFacts on units
  if (x.resoFacts && (x.description || x.homeDescription)) return true;
  return false;
}

/** Extract {zpid, detailUrl} from a search-result card.
 *  JS-structure first (React props embedded in DOM), HTML fallback. */
export function cardInfo(card) {
  const zpid = card.dataset?.zpid || card.getAttribute?.('data-zpid') ||
    card.getAttribute?.('data-test-zpid') || null;
  let detailUrl = null;
  const a = card.querySelector?.('a[href*="/homedetails/"]');
  if (a) {
    detailUrl = a.getAttribute('href');
    if (detailUrl?.startsWith('/')) detailUrl = location.origin + detailUrl;
  }
  // zpid fallback: parse from href (.../123456_zpid/)
  if (!zpid && detailUrl) {
    const m = detailUrl.match(/\/(\d+)_zpid\//);
    if (m) return { zpid: m[1], detailUrl };
  }
  return zpid ? { zpid, detailUrl } : null;
}

/** Place to insert the badge row inside a card: right after the photo area
 *  when detectable, else at card top. Photo containers in Zillow's cards are
 *  the first non-anchor <div> child. */
export function badgeAnchor(card) {
  const firstDiv = card.querySelector(':scope > div');
  return firstDiv || null;
}
