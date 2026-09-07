# Zillow Power Filters

**→ [INSTALL.md](INSTALL.md) — get it in your browser in ~2 minutes (no tools needed).**

Chrome extension (MV3) that adds the filters Zillow won't: **gas range**, structural masonry, in-unit laundry, central A/C, hardwood floors, dishwasher, attached garage, radiator/radiant heat, new construction — plus a red-flag layer for failing materials (polybutylene, Kitec, galvanized plumbing, FPE panels, aluminum wiring, cast-iron stacks).

## How it works

Zillow search results carry no appliance/condition data, but every **detail page** embeds its full MLS record (`resoFacts`) inside `__NEXT_DATA__`. This extension:

1. Tags each search-result card with verdict chips (`✓/✗/?`) per enabled filter, by reading the listing's own embedded JSON via a rate-limited, cached same-origin fetch (your session, your cookies — looks like normal browsing to Zillow).
2. Detail pages get a banner using the full embedded record (no fetch at all).
3. `?` = Zillow surfaced no data. **Unknowns are never hidden**; only confirmed failures are, and only in "Hide" mode.

Cache: 7-day TTL keyed by zpid, capped (eviction in `background.js`). Fetch policy: ≤2 concurrent, ~700ms+ jitter — human-shaped.

## Install (unpacked, dev)

```bash
npm run build      # assembles dist/ (manifest + extension/ + shared/)
# generate icons (any 128/48/16 png set) — see extension/icons/README.md
```

Then: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## Repo layout

```
shared/detector.js      pure matching engine (browser + node, zero deps)
extension/              MV3 sources (import ../shared/)
tests/                  node:test suite for detector
scripts/build.js        assembles dist/
```

## Semantics that matter

- **Gas range**: `appliances ∋ {Gas Range, Gas Stove, Gas Cooktop, Gas Oven}` → ✓; electric/induction-only or "converted gas → electric" text → ✗/⚠; bare "gas available" is NOT a match.
- **Masonry**: structural brick/stone/block via `constructionMaterials`, `structureType`, `architecturalStyle`, `exteriorFeatures`; **"Brick Veneer"/"Stone Front" → ✗**; pre-1940 builds count as ✓ when materials are missing.
- **Plumbing brass/copper**: no structured field exists in Zillow's data (nobody lists supply-pipe material). Instead, the **concern layer** surfaces mention of *failing* plastics (polybutylene, Kitec, CPVC) and galvanized supply — a "no bad news" posture rather than false precision.

## Adding a filter

1. Add an entry to `FILTERS` in `shared/detector.js` (id, label, icon, `evaluate(listing)` returning `{status, matched, source}`).
2. Tests in `tests/detector.test.js`. The popup, badges, and banner pick it up automatically.

## Test

```bash
npm test         # node --test tests/
npm run build    # assemble dist/
```

## Legal / etiquette

Personal-use, display-only enhancement of pages you are already browsing; nothing is republished or collected. Detail-page fetches are throttled and cached to keep load negligible.
