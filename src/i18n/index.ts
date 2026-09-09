import { ja } from './ja';
import { LOCALES, DEFAULT_LOCALE, type Locale } from './locales';
import { en } from './en';

/**
 * 多言語。文言はここに集約し、コードに直書きしない。
 * 追加は locales に一つ足すだけで済む形にしてある。
 */

export { LOCALES, DEFAULT_LOCALE, type Locale } from './locales';

const TABLES = { ja, en } as const;

/** 言語ごとに表記が変わるものの一覧。部屋データもこの形で持つ */
export type Localized<T> = Record<Locale, T>;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 言語の決め方。
 * URL の ?lang= → 保存された選択 → ブラウザの設定 → 既定（日本語）
 */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  if (fromQuery && isLocale(fromQuery)) return fromQuery;

  try {
    const saved = window.localStorage.getItem('locale');
    if (saved && isLocale(saved)) return saved;
  } catch {
    // プライベートモードなどで localStorage が使えないことがある
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (base && isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem('locale', locale);
  } catch {
    // 保存できなくても動作に影響しない
  }
}

let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 現在の言語の文言表 */
export function strings(): typeof ja {
  return TABLES[current];
}

/** 部屋データなど、言語ごとに用意された値から現在の言語のものを取る */
export function localized<T>(value: Localized<T>): T {
  return value[current] ?? value[DEFAULT_LOCALE];
}

export const LOCALE_NAMES: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
};
