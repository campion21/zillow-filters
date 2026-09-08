# Loading the extension

Use `extension/manifest.json` directly — Chrome can load the raw `extension/`
folder now (no dist build needed). The old `manifest.json.nobuild` template and
`scripts/build.js` are retired; `zillow-extract.js` is removed (inlined).

**Load:** chrome://extensions → Developer mode → Load unpacked → select
`extension/` (the folder containing manifest.json).
