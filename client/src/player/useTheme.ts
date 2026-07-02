import { useEffect, useState } from 'react';

export const THEMES = [
  { id: 'red-tinsel', label: 'Red Tinsel' },
  { id: 'pink', label: 'Pink CRT' },
];
const DEFAULT_THEME = 'red-tinsel';
const LS_THEME = 'kk-theme';
const LS_BG = 'kk-custom-bg';

const root = document.documentElement;

// Hot-swappable named themes + custom uploaded background. Swapping sets
// <html data-theme>; the CSS cascade repaints instantly. An uploaded image
// overrides --scene-bg inline on <html>.
export function useTheme() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(LS_THEME) || DEFAULT_THEME);

  useEffect(() => {
    root.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  // Restore a previously uploaded background once on mount.
  useEffect(() => {
    const bg = localStorage.getItem(LS_BG);
    if (bg) root.style.setProperty('--scene-bg', bg);
  }, []);

  function applyCustomBackground(cssValue: string | null) {
    if (cssValue) {
      root.style.setProperty('--scene-bg', cssValue);
      localStorage.setItem(LS_BG, cssValue);
    } else {
      root.style.removeProperty('--scene-bg');
      localStorage.removeItem(LS_BG);
    }
  }

  function selectTheme(id: string) {
    applyCustomBackground(null); // a named theme clears any uploaded image
    setTheme(id);
  }

  function uploadBackground(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const bg = `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55)), url("${reader.result}") center/cover no-repeat`;
      applyCustomBackground(bg);
    };
    reader.readAsDataURL(file);
  }

  return { theme, selectTheme, uploadBackground, clearBackground: () => applyCustomBackground(null) };
}
