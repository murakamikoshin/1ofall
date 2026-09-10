/** 言語の一覧だけ。zod からも UI からも読むので、依存を持たない場所に置く */
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';


/**
 * 助言の文字数上限は言語で変える。
 * 日本語20文字の制約は「一度に二つまでしか名前を挙げられない」ことを狙ったもの。
 * 英語のラベルは長いので、同じ性質を保つには枠が要る。
 *
 * 42 では**枠が足りていなかった**。英語のラベルは中央12字・9割で19字あるので、
 * 二つ並べると38字になり、残る4字に収まる言い方は「 or 」しか無い。
 * 実測で二択の組の18.4%が「言い方が一つ以下しか収まらない」状態で、
 * 選べないので同じ型が一部屋に四回並んでいた（日本語は0.0%）。
 * 48 にすると6.2%まで下がる。
 *
 * 「一度に二つまで」を守っているのは**この上限ではなく** moderation の
 * `countChoicesMentioned`（MAX_CHOICES_PER_HINT）なので、緩めても性質は崩れない。
 */
export const HINT_LIMIT_BY_LOCALE: Record<Locale, number> = { ja: 20, en: 48 };
