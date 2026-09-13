import type { Pen } from './style';

/**
 * 形容の描き分け。**札に書いてあることが絵に出る。**
 *
 * 部屋の選択肢は「太い網／破れた網／濡れた網／重りのついた網／目の細かい網」
 * のように、**同じ物の形容だけが違う**形で書かれている。
 * だから形容を絵にできれば、5枚は自然に描き分かれる。
 *
 * 逆に、形容を見ずに適当な印を振っていると
 * 「取手のない扉」に取手が描かれる。実際にそうなっていた。
 *
 * 描き込みの量は**多くて二つ**に抑える。豪華な絵があると
 * 「それが正解」という手掛かりになる（規約 §5 の最重要項目）。
 */

export type Treat =
  | 'crack' | 'drip' | 'speck' | 'cord' | 'drape' | 'twin' | 'small' | 'big'
  | 'omit' | 'fill' | 'hook' | 'tilt' | 'heat' | 'flame' | 'ice' | 'dark'
  | 'inner' | 'sound' | 'sleep' | 'trail' | 'notch' | 'seal' | 'ajar' | 'grin'
  | 'sheen' | 'mute' | 'weighty' | 'stud' | 'grain' | 'fold' | 'corner';

/** 語 → 描き分け。英語の札から引く（日本語より語形が安定している） */
const WORDS: Record<string, Treat> = {
  // 壊れ
  torn: 'crack', cracked: 'crack', chipped: 'crack', broken: 'crack', split: 'crack',
  crumbling: 'crack', worn: 'crack', holed: 'crack',
  'worm-eaten': 'trail', fallen: 'tilt', headless: 'omit',
  // 切れている物は「無い」ほうが伝わる（罅と同じ絵になっていた）
  cut: 'omit', frayed: 'cord', warped: 'tilt', unsealed: 'crack',
  // 濡れ
  wet: 'drip', damp: 'drip', flooded: 'drip', soaked: 'drip', dripping: 'drip',
  // 古び
  mossy: 'speck', rusted: 'speck', old: 'speck', muddy: 'speck', 'mud-caked': 'speck',
  caked: 'speck', dirty: 'speck', reeking: 'speck', sour: 'speck', dried: 'speck',
  // 括り
  corded: 'cord', tied: 'cord', roped: 'cord', knotted: 'cord', bound: 'cord',
  'roped-off': 'cord', braided: 'inner',
  // 封は紐と分ける（同じ部屋に「封のある箱」と「紐で縛った箱」が並ぶ）
  sealed: 'seal', wax: 'seal', stamped: 'seal',
  // 覆い
  covered: 'drape', 'cloth-wrapped': 'drape', wrapped: 'drape', shuttered: 'drape',
  boarded: 'drape', 'cloth-draped': 'drape', 'cloth-hung': 'drape', 'paper-wrapped': 'drape',
  partway: 'crack', halfway: 'crack',
  hidden: 'drape',
  // 二つ以上
  paired: 'twin', double: 'twin', stacked: 'twin', swarming: 'twin', coins: 'twin',
  keys: 'twin', candles: 'twin', stones: 'twin', doubled: 'twin', both: 'twin',
  // 小さい
  small: 'small', thin: 'small', low: 'small', narrow: 'small', short: 'small',
  light: 'small', fine: 'small', 'fine-mesh': 'small', stub: 'small', 'thin-soled': 'small',
  // 大きい
  great: 'big', wide: 'big', large: 'big', tall: 'big', high: 'big',
  deep: 'big', overloaded: 'big', long: 'big', oversized: 'big',
  // 重いのは大きいのと分ける（同じ部屋に並ぶ：重い旗と高い旗）
  heavy: 'weighty', thick: 'weighty',
  // 無い
  handleless: 'omit', eyeless: 'omit', bottomless: 'omit', unsigned: 'omit',
  blank: 'omit', empty: 'omit', nothing: 'omit', none: 'omit', bare: 'omit',
  dry: 'omit', unlit: 'omit', oil: 'omit', blocked: 'drape',
  loose: 'tilt', 'half-shut': 'ajar', ajar: 'ajar',
  stopped: 'sleep', sleeping: 'sleep', still: 'sleep',
  // 音がしないのは、音の輪を打ち消す形で出す
  silent: 'mute', soundless: 'mute', quiet: 'mute',
  // 中身
  full: 'fill', laden: 'fill', 'over-full': 'fill', crowded: 'fill', 'grain-raised': 'fill',
  // 吊る
  hanging: 'hook', hung: 'hook', suspended: 'hook',
  // 傾く
  leaning: 'tilt', slanted: 'tilt', tilted: 'tilt', upturned: 'tilt', sunken: 'tilt',
  // 熱
  steaming: 'heat', warm: 'heat', hot: 'heat', smoking: 'heat', foaming: 'heat',
  // 火
  lit: 'flame', burning: 'flame', ember: 'flame', embers: 'flame', guttering: 'flame',
  // 氷
  iced: 'ice', frozen: 'ice', snow: 'ice', 'snow-covered': 'ice', icy: 'ice',
  // 黒
  black: 'dark', sooty: 'dark', charred: 'dark', burnt: 'dark', dark: 'dark', vermilion: 'dark',
  // 白・澄み
  clear: 'inner', polished: 'inner', new: 'inner', clean: 'inner',
  gilded: 'inner', shining: 'inner', ripe: 'inner',
  // 白は「澄んでいる」と分ける（同じ部屋に並ぶ：澄んだ水と白い乳）
  white: 'sheen', pale: 'sheen', milky: 'sheen', 'white-dry': 'sheen',
  // 音
  singing: 'sound', talkative: 'sound', ringing: 'sound', running: 'sound',
  calling: 'sound', laughing: 'grin', smiling: 'grin',
  // 跡
  footprints: 'trail', trodden: 'trail', 'worm': 'trail', crawling: 'trail',
  /*
   * 材。**一番多く取りこぼしていた群**（鉄の・木の・紙の・赤い…）。
   * 形容が当たらないと順番で印を振ることになり、札と絵が噛み合わない。
   */
  iron: 'stud', metal: 'stud', brass: 'stud', bronze: 'stud', chainmail: 'stud',
  wooden: 'grain', wood: 'grain', bamboo: 'grain', straw: 'grain', leather: 'grain',
  log: 'grain', timber: 'grain',
  paper: 'fold',
  red: 'corner', 'red-painted': 'corner', 'red-ink': 'corner', painted: 'corner',
  // 刻み
  latticed: 'notch', ruled: 'notch',
  // 彫り・縫い目は線二本で足りる（格子を丸い物に重ねると潰れる）
  engraved: 'inner', seamed: 'inner',
};

/** 札から描き分けを引く。多くて二つ（描き込みの量を揃える） */
export function treatsFor(labelEn: string): Treat[] {
  const words = labelEn.toLowerCase().replace(/[^a-z\- ]/g, ' ').split(/\s+/).filter(Boolean);
  const found: Treat[] = [];
  // 「no ...」「with no ...」は打ち消し
  if (/\bno\b|\bnot\b|\bwithout\b/.test(labelEn.toLowerCase())) found.push('omit');
  for (const w of words) {
    const t = WORDS[w];
    if (t && !found.includes(t)) found.push(t);
  }
  return found.slice(0, 2);
}

/** 形の上に重ねる（本体は触らない） */
export function overlay(p: Pen, t: Treat): string {
  switch (t) {
    case 'crack': return p.L('M84 30 L70 50 L86 62');
    case 'drip': return p.L('M46 100 V110 M64 102 V112 M82 100 V110');
    case 'speck': return p.DOT(44, 40, 3) + p.DOT(58, 34, 2) + p.DOT(86, 46, 3) + p.DOT(74, 30, 2);
    case 'cord': return p.L('M26 72 H102') + p.L('M58 66 L70 78 M70 66 L58 78');
    // 布は物の幅に合わせて狭めに。広いと台に見える
    case 'drape': return p.F('M38 38 Q64 54 90 38 V26 H38 Z');
    // もう一つ後ろに覗いている、に見せる
    case 'twin': return p.L('M94 34 H106 V98 H94');
    case 'fill': return p.DOT(54, 72, 4) + p.DOT(66, 80, 4) + p.DOT(78, 70, 4);
    case 'hook': return p.L('M64 18 V32') + p.C(64, 18, 5);
    case 'heat': return p.L('M52 30 Q58 22 52 14 M76 30 Q82 22 76 14');
    case 'flame': return p.F('M64 12 Q72 22 64 30 Q56 22 64 12');
    case 'ice': return p.L('M40 24 H56 M62 24 H78 M84 24 H100');
    // 黒い面。細い物に重ねても潰れない幅に
    case 'dark': return p.F('M52 54 H78 V80 H52 Z');
    case 'inner': return p.L('M40 44 H88 M40 84 H88');
    case 'sound': return p.L('M100 40 Q112 64 100 88 M88 48 Q96 64 88 80');
    case 'sleep': return p.L('M46 46 H60 M68 46 H82');
    case 'trail': return p.DOT(36, 104, 3) + p.DOT(56, 110, 3) + p.DOT(76, 104, 3) + p.DOT(96, 110, 3);
    case 'notch': return p.L('M40 48 H88 M40 64 H88 M40 80 H88 M56 40 V88 M72 40 V88');
    case 'seal': return p.C(92, 88, 10, true) + p.DOT(92, 88, 3);
    case 'ajar': return p.L('M64 30 L92 44 V96 L64 106');
    case 'grin': return p.L('M48 88 Q64 100 80 88');
    case 'sheen': return p.L('M44 40 L54 30 M56 42 L66 32');
    case 'mute': return p.L('M92 46 Q104 64 92 82 M84 42 L106 86');
    // 重い。下に効いている線を一本足す
    case 'weighty': return p.L('M32 106 H96');
    // 鉄。鋲を二つ打つ
    case 'stud': return p.DOT(44, 96, 4) + p.DOT(84, 96, 4);
    /*
     * 材の印は**真ん中の帯に置く**（y 52〜92）。
     * 上の隅に置いていたら、低く座る物（履物・舟・灰）の上に浮いて見えた。
     */
    // 木。木目を二本
    case 'grain': return p.L('M44 62 Q54 70 44 78 M80 62 Q90 70 80 78');
    // 紙。角を折る
    case 'fold': return p.L('M86 54 L100 68 H86 Z');
    // 塗り。角に色が乗っている
    case 'corner': return p.F('M30 56 H50 L30 76 Z');
    // 本体を変えるもの（overlay では描かない）
    case 'small':
    case 'big':
    case 'tilt':
    case 'omit':
    default: return '';
  }
}

/** 本体そのものを変えるもの */
export function bodyTransform(treats: readonly Treat[]): { scale: number; spin: number } {
  let scale = 1;
  let spin = 0;
  for (const t of treats) {
    if (t === 'small') scale = 0.82;
    if (t === 'big') scale = 1.1;
    if (t === 'weighty') scale = 1.06;
    if (t === 'tilt') spin = 14;
  }
  return { scale, spin };
}
