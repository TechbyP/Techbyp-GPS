
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalStorage } from './useLocalStorage';

export const useLanguage = () => {
  const { i18n } = useTranslation();
  const [language, setLanguageStorage] = useLocalStorage<string>('language', 'en');

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setLanguageStorage(lng);
  };

  // Sync with i18n on mount and when language changes
  React.useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language).catch(err => {
        console.error('Failed to change language:', err);
      });
    }
  }, [language, i18n]);

  return {
    language: i18n.language,
    changeLanguage,
    t: i18n.t,
  };
};