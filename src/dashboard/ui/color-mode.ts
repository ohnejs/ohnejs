import { ref } from '../../utils/reactive/ref.ts';
import './tokens.ts';

/**
 * A color mode the user can prefer.
 * `system` follows the operating system live.
 */
export type ColorMode = 'system' | 'light' | 'dark';

const KEY = 'ohne-color-mode';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
const preference = ref<ColorMode>(storedPreference());

media.addEventListener('change', () => {
  systemDark.value = media.matches;
  apply();
});
apply();

/**
 * Reads the preferred color mode; the read is reactive.
 */
export function colorMode(): ColorMode {
  return preference.value;
}

/**
 * Reads the mode actually in effect: a `system` preference resolves against the OS.
 * The read is reactive, including live OS changes while on `system`.
 */
export function resolvedColorMode(): 'light' | 'dark' {
  if (preference.value === 'system') return systemDark.value ? 'dark' : 'light';
  return preference.value;
}

/**
 * Sets and persists the preferred color mode, then applies it to `<html>`.
 * Transitions are suppressed for 150ms around the swap, so the theme repaints in one step.
 */
export function setColorMode(mode: ColorMode): void {
  document.body.classList.add('ohne-no-transition');
  preference.value = mode;
  localStorage.setItem(KEY, mode);
  apply();
  setTimeout(() => document.body.classList.remove('ohne-no-transition'), 150);
}

function storedPreference(): ColorMode {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Applies the resolved mode as a `light` or `dark` class on `<html>`.
 * The shell sets the initial class before first paint; this keeps it in sync afterwards.
 */
function apply(): void {
  const dark = preference.value === 'dark' || (preference.value === 'system' && systemDark.value);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
}
