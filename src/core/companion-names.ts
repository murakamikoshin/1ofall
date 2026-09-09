import { getLocale } from '../i18n';

/**
 * 仲間と助言者の名前。AI と人間で同じ井戸から引く（見分けがつくと興が削がれる）。
 * 言語ごとに用意する。英語で遊んでいる人の画面に「たろう」だけが並ぶと、
 * 誰が誰だか覚えられない＝記録が使えない。
 */
const BY_LOCALE = {
  ja: [
    'たろう', 'はなこ', 'ゲンさん', 'みかん', 'クロ', 'ヤス', 'せつ', 'とんび',
    'まめ', 'ウシオ', 'かがり', 'ノブ', 'すず', 'イチ', 'ハルさん', 'ぬい',
    'テツ', 'こより', 'ゴロー', 'あかね', 'シノ', 'まさ', 'ちどり', 'ぜんじ',
  ],
  en: [
    'Mott', 'Bess', 'Old Gray', 'Pip', 'Crow', 'Hale', 'Wren', 'Kite',
    'Bean', 'Tide', 'Ember', 'Nob', 'Rill', 'Ash', 'Marlow', 'Nim',
    'Rust', 'Twine', 'Gully', 'Sable', 'Fen', 'Mash', 'Plover', 'Zeb',
  ],
} as const;

export function companionNames(): readonly string[] {
  return BY_LOCALE[getLocale()] ?? BY_LOCALE.ja;
}

/** 古い呼び出し口。日本語の並びをそのまま返す */
export const COMPANION_NAMES = BY_LOCALE.ja;
