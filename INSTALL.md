# Install Zillow Power Filters (Chrome)

## Install / update (~2 minutes)

1. Download the ZIP: https://github.com/campion21/zillow-filters/archive/refs/heads/main.zip
2. Unzip it.
3. Open `chrome://extensions` in Chrome → toggle **Developer mode** on (top right).
4. **Load unpacked** → select the **`extension`** folder (the one containing `manifest.json`).
   - Updating? Remove the old entry first, then Load unpacked again on the new ZIP's `extension/`.
5. Pin it: puzzle-piece toolbar icon → pin **Zillow Power Filters**.

No build step — the repo ships load-ready. (`dist/` is now just a stale artifact; ignore it.)

## First run — what you should see within seconds

1. Go to any Zillow search page (rent or buy).
2. **A blue-bordered status chip appears at bottom-center:** "ZPF: scan — N card element(s) found".
   - If N is 0, Zillow's DOM doesn't match our selectors → send me what it says.
   - If no chip at all: check `chrome://extensions` that the extension is enabled, hard-refresh the Zillow tab (Ctrl/Cmd+Shift+R), and look for `[ZPF]` lines in DevTools Console.
3. **Each result card gets a `⏳ ZPF` chip** at its top. Over ~30–60s these resolve into verdict chips (🔥✓/✗/?) as listing details load (detail fetches are politely throttled).
4. Hover any chip for the evidence behind the verdict.
5. Open any listing → **Power Filters banner** near the top.

## Toolbar popup

Checkboxes for 9 filters (default: gas range only), Tag/Hide mode, concern badges on/off.

## Known limits

- Map pins: no chips (pins carry no per-listing DOM attributes).
- Many rentals expose no appliance data → ❔ is honest "no data", never hidden in Hide mode.
- Concern chips (⚠) come from listing text and are advisory.

## Uninstall

`chrome://extensions` → **Remove**.
