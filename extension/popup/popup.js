/* Zillow Power Filters popup — plain script, messaging only. No module imports.
 * Filter metadata lives in background.js (get-settings), so this never imports
 * shared code directly. */
(function () {
  'use strict';

  const persist = (patch) => chrome.runtime.sendMessage({ type: 'set-settings', patch });
  const state = () => chrome.runtime.sendMessage({ type: 'get-settings' });

  async function render() {
    const root = document.getElementById('filters');
    if (!root) return;
    let settings;
    try {
      settings = await state();
    } catch (e) {
      root.textContent = 'Could not load settings: ' + e.message;
      return;
    }
    root.replaceChildren();

    // meta supplied by background as [{id, label, icon}]
    for (const f of settings.filterMeta || []) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = settings.enabledFilters.includes(f.id);
      box.addEventListener('change', () => {
        const enabled = new Set(settings.enabledFilters);
        box.checked ? enabled.add(f.id) : enabled.delete(f.id);
        persist({ enabledFilters: [...enabled] });
      });
      label.append(box, document.createTextNode(`${f.icon} ${f.label}`));
      root.append(label);
    }

    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.checked = r.value === settings.mode;
      r.addEventListener('change', () => persist({ mode: r.value }));
    });

    const concerns = document.getElementById('concerns');
    if (concerns) {
      concerns.checked = settings.showConcerns;
      concerns.addEventListener('change', () => persist({ showConcerns: concerns.checked }));
    }
  }

  render();
})();
