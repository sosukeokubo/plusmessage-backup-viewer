export type ThemeChoice = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'pmbv.theme';
const VALID: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

function isTheme(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (VALID as readonly string[]).includes(v);
}

export function readTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    // localStorage may throw in sandboxed contexts — fall through to default.
  }
  return 'auto';
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset['theme'] = choice;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Persistence is best-effort; runtime behavior still works without it.
  }
}
