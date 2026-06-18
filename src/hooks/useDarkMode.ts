import { useEffect, useCallback, useState } from 'react';

function readStoredDark(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem('darkMode');
  if (raw === null) return true; // default to dark if nothing stored
  try {
    if (raw === 'true' || raw === 'false') return raw === 'true';
    return Boolean(JSON.parse(raw));
  } catch {
    return true;
  }
}

export function useDarkMode(): [boolean, () => void] {
  const [isDark, setIsDark] = useState<boolean>(() => readStoredDark());

  // Sync to <html> and localStorage when value changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    window.localStorage.setItem('darkMode', JSON.stringify(isDark));
  }, [isDark]);

  // Listen for changes from other components/tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'darkMode' || event.newValue === null) return;
      try {
        const next = JSON.parse(event.newValue);
        if (typeof next === 'boolean') {
          setIsDark(next);
        }
      } catch {
        // ignore parse errors
      }
    };

    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && typeof detail.isDark === 'boolean') {
        setIsDark(detail.isDark);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('dark-mode-changed', handleCustom as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('dark-mode-changed', handleCustom as EventListener);
    };
  }, []);

  // Toggle and broadcast to other listeners in this tab
  const toggleDarkMode = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dark-mode-changed', { detail: { isDark: next } }));
      }
      return next;
    });
  }, []);

  return [isDark, toggleDarkMode];
}
