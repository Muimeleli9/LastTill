const THEME_KEY = 'lasttill.theme';

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch { /* Preference storage is optional; the system default still applies. */ }
  return null;
}

export function currentTheme() {
  return savedTheme() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  document.querySelectorAll('.theme-toggle').forEach(button => {
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.querySelector('.theme-label')?.replaceChildren(dark ? 'Light mode' : 'Dark mode');
  });
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* Preference storage is optional. */ }
  applyTheme(next);
}

export function initTheme() {
  applyTheme(currentTheme());
  document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', toggleTheme));
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!savedTheme()) applyTheme(currentTheme());
  });
}
