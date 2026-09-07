# Install Zillow Power Filters (Chrome)

## Option A — No tools needed, ~2 minutes (recommended)

1. Download the ZIP: https://github.com/campion21/zillow-filters/archive/refs/heads/main.zip
2. Unzip it.
3. Open `chrome://extensions` in Chrome → toggle **Developer mode** on (top right).
4. Click **Load unpacked** → select the **`dist`** folder inside the unzipped directory (the folder containing `manifest.json`).
5. Pin it: puzzle-piece icon in the toolbar → pin **Zillow Power Filters**.

The ready-to-load `dist/` folder ships in the repo — no build step required.

## Option B — Build from source (if you want to hack on it)

```bash
git clone https://github.com/campion21/zillow-filters.git
cd zillow-filters
npm run build    # regenerates dist/  (needs Node 18+; icons included)
npm test         # optional: 38 detector tests
```

Then steps 3–5 from Option A.

## Using it

1. Browse Zillow (rent or buy) exactly as usual.
2. Each result card gets chips as its data loads: `✓` pass / `✗` fail / `?` no data, plus `⚠` red-flag mentions (polybutylene, galvanized, Kitec…).
3. Click the toolbar icon to toggle filters and Tag/Hide mode. Defaults: gas range on, Tag mode, concerns on.
4. **Hover any chip** to see the exact evidence — the structured appliance string or the description sentence that produced the verdict.
5. Open any listing: a **Power Filters banner** appears near the top with full labels.

## Verify it's reading correctly

- A detail page should show the banner within ~2 seconds.
- Hover a chip and compare with Zillow's own **Facts & features** section (Appliances / Cooling / Flooring) — the extension reads the same underlying data, so they should agree.
- If no chips appear on a search page after ~15 seconds of scrolling, Zillow has likely changed their DOM — that's a bug in `extension/zillow-extract.js`, please report it.

## Updating

Repeat Option A with a fresh ZIP (or `git pull && npm run build`), then click the **reload** icon on the extension's card at `chrome://extensions` and refresh your Zillow tabs.

## Known limits

- Many rental listings expose no structured appliance data → you'll see ❔. Unknowns are **never** hidden.
- Hide mode removes only confirmed failures (✗).
- `⚠` concern chips come from listing-description text and are advisory — read the snippet in the tooltip.

## Uninstall

`chrome://extensions` → **Remove**. No data leaves your machine either way.
