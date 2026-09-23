import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark', // Dark theme by default
      toggleTheme: () => set((state) => {
        const nextTheme = state.theme === 'light' ? 'dark' : 'light';
        const root = window.document.documentElement;
        if (nextTheme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        return { theme: nextTheme };
      }),
      setTheme: (theme) => set(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        return { theme };
      }),
    }),
    {
      name: 'voice-forge-theme',
    }
  )
);
