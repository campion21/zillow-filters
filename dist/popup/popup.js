import { FILTERS } from '../../shared/detector.js';

const persist = (patch) => chrome.runtime.sendMessage({ type: 'set-settings', patch });
const state = () => chrome.runtime.sendMessage({ type: 'get-settings' });

async function render() {
  const settings = await state();
  const wrap = document.getElementById('filters');
  wrap.replaceChildren();

  for (const f of FILTERS) {
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
    wrap.append(label);
  }

  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === settings.mode;
    r.addEventListener('change', () => persist({ mode: r.value }));
  }

  const concerns = document.getElementById('concerns');
  concerns.checked = settings.showConcerns;
  concerns.addEventListener('change', () => persist({ showConcerns: concerns.checked }));
}

render();
