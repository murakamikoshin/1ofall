/** 言語の一覧だけ。zod からも UI からも読むので、依存を持たない場所に置く */
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';


/**
 * 助言の文字数上限は言語で変える。
 * 日本語20文字の制約は「一度に二つまでしか名前を挙げられない」ことを狙ったもの。
 * 英語のラベルは長いので、同じ性質を保つには枠が要る。
 */
export const HINT_LIMIT_BY_LOCALE: Record<Locale, number> = { ja: 20, en: 42 };
