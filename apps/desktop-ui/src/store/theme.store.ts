import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'octoml-theme-storage',
    }
  )
);

export function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  root.classList.remove('light', 'dark');

  let resolvedTheme = theme;
  if (theme === 'system') {
    resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  root.classList.add(resolvedTheme);
}

// Subscribe to store changes to apply the theme instantly in the current window
useThemeStore.subscribe((state) => {
  applyTheme(state.theme);
});

if (typeof window !== 'undefined') {
  // Listen for media query changes when the theme is set to 'system'
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    if (useThemeStore.getState().theme === 'system') {
      applyTheme('system');
    }
  };

  // Modern browsers / Electron
  mediaQuery.addEventListener('change', handleSystemThemeChange);

  // Sync state between multiple windows via localStorage storage events
  window.addEventListener('storage', (e) => {
    if (e.key === 'octoml-theme-storage') {
      try {
        const parsed = JSON.parse(e.newValue || '{}');
        const nextTheme = parsed.state?.theme;
        if (nextTheme && nextTheme !== useThemeStore.getState().theme) {
          useThemeStore.getState().setTheme(nextTheme);
        }
      } catch (err) {
        console.error('Error synchronizing theme across windows:', err);
      }
    }
  });
}
