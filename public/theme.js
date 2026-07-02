// Player theming: hot-swappable named themes + custom uploaded background.
// A theme is a block of CSS variables in themes.css keyed by [data-theme].
// Swapping = set <html data-theme="…"> → the CSS cascade repaints instantly.
// An uploaded image just overrides --scene-bg inline on <html>.

const THEMES = [
  { id: 'red-tinsel', label: 'Red Tinsel' },
  { id: 'pink', label: 'Pink CRT' },
];
const DEFAULT_THEME = 'red-tinsel';
const LS_THEME = 'kk-theme';
const LS_BG = 'kk-custom-bg';

const root = document.documentElement;

function applyTheme(id) {
  root.dataset.theme = id;
  localStorage.setItem(LS_THEME, id);
}

// cssValue: a full CSS background value, or null to clear the override.
function applyCustomBackground(cssValue) {
  if (cssValue) {
    root.style.setProperty('--scene-bg', cssValue);
    localStorage.setItem(LS_BG, cssValue);
  } else {
    root.style.removeProperty('--scene-bg');
    localStorage.removeItem(LS_BG);
  }
}

// --- Restore immediately (minimize flash of the default theme) ---
applyTheme(localStorage.getItem(LS_THEME) || DEFAULT_THEME);
const savedBg = localStorage.getItem(LS_BG);
if (savedBg) root.style.setProperty('--scene-bg', savedBg);

// --- Wire the host control bar once the DOM exists ---
document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('theme-select');
  const upload = document.getElementById('theme-upload');
  const clearBtn = document.getElementById('theme-clear');
  if (!select) return;

  for (const t of THEMES) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    select.appendChild(opt);
  }
  select.value = localStorage.getItem(LS_THEME) || DEFAULT_THEME;

  // Switching a named theme clears any uploaded background.
  select.onchange = () => { applyCustomBackground(null); applyTheme(select.value); };

  upload.onchange = () => {
    const file = upload.files && upload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Dark scrim keeps the cabinet + reactions readable over any image.
      const bg = `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55)), url("${reader.result}") center/cover no-repeat`;
      applyCustomBackground(bg);
    };
    reader.readAsDataURL(file);
  };

  clearBtn.onclick = () => { applyCustomBackground(null); upload.value = ''; };
});
