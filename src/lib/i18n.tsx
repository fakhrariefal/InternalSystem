import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AgingBucket } from '../models/erpLogic';
import type { AppModule } from '../models/types';

export type Language = 'id' | 'en';

const STORAGE_KEY = 'domestiq_lang';

interface I18nContextValue {
  lang: Language;
  setLang: (next: Language) => void;
  toggleLang: () => void;
  tr: (idText: string, enText: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'id';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'id') return saved;
  } catch {
    // Ignore storage read restrictions
  }
  return 'id';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLanguage);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore storage write restrictions
      }
      document.documentElement.lang = next;
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const toggleLang = useCallback(() => {
    setLang(lang === 'id' ? 'en' : 'id');
  }, [lang, setLang]);

  const tr = useCallback(
    (idText: string, enText: string) => (lang === 'en' ? enText : idText),
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, tr }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: 'id',
      setLang: () => undefined,
      toggleLang: () => undefined,
      tr: (idText: string) => idText,
    };
  }
  return ctx;
}

export const MODULE_LABELS: Record<
  AppModule,
  { id: string; en: string; shortId: string; shortEn: string }
> = {
  dashboard: { id: 'Beranda Eksekutif', en: 'Executive Dashboard', shortId: 'Beranda', shortEn: 'Home' },
  master: { id: 'Master Data', en: 'Master Data', shortId: 'Master', shortEn: 'Master' },
  purchasing: { id: 'Purchase Order', en: 'Purchase Orders', shortId: 'PO', shortEn: 'PO' },
  inventory: { id: 'Inventory & Gudang', en: 'Inventory & Warehouse', shortId: 'Stok', shortEn: 'Stock' },
  sales: { id: 'Sales Order', en: 'Sales Orders', shortId: 'SO', shortEn: 'Sales' },
  accounting: { id: 'Accounting & Buku Besar', en: 'Accounting & Ledger', shortId: 'Akunting', shortEn: 'Ledger' },
  reports: { id: 'Laporan', en: 'Reports', shortId: 'Laporan', shortEn: 'Reports' },
  system: { id: 'Sistem & Audit', en: 'System & Audit', shortId: 'Sistem', shortEn: 'System' },
};

export function formatAgingBucketLabel(bucket: AgingBucket, lang: Language): string {
  if (lang === 'id') return bucket;
  switch (bucket) {
    case 'Belum Jatuh Tempo':
      return 'Current';
    case '1-30 Hari':
      return '1-30 Days';
    case '31-60 Hari':
      return '31-60 Days';
    case '61-90 Hari':
      return '61-90 Days';
    case '> 90 Hari':
      return '> 90 Days';
  }
}
