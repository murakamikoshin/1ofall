/** 言語の一覧だけ。zod からも UI からも読むので、依存を持たない場所に置く */
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';
