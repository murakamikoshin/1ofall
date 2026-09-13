/**
 * 選択肢の絵の作り。**全枚数で同じ規約を、コードで守る。**
 *
 * `docs/IMAGE_STYLE.md` の規約（均一な太い黒線・平らな塗り・影は右下に1段・
 * 背景は同色・正方形・中央・余白は均等）は、生成AIに守らせるための文章だった。
 * コードで描けば**守るのではなく、外せなくなる。**
 * 線幅も影も背景も、ここにしか無いので1枚だけ浮くことが起こらない。
 */

export const PAPER = '#c2b192';
export const INK = '#14100b';
/** 平らな塗り。**全枚数で一色**。絵によって色を変えると、それが手掛かりになる */
export const TONE = '#a29073';

/** 128 の枠。書き出しは何倍でも効く（線の比は変わらない） */
export const BOX = 128;
export const STROKE = 7;

/** 描く道具。影の層と本体の層で同じ形を二度描くために、筆を差し替える */
export interface Pen {
  /** 塗って輪郭も引く */
  F(d: string): string;
  /** 線だけ */
  L(d: string): string;
  /** 点（目・釘・穴） */
  DOT(x: number, y: number, r?: number): string;
  /** 円（輪・玉） */
  C(cx: number, cy: number, r: number, filled?: boolean): string;
}

function pen(fill: string, ink: string): Pen {
  const base = `stroke="${ink}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round"`;
  return {
    F: (d) => `<path d="${d}" fill="${fill}" ${base}/>`,
    L: (d) => `<path d="${d}" fill="none" ${base}/>`,
    DOT: (x, y, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`,
    C: (cx, cy, r, filled = false) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${filled ? fill : 'none'}" ${base}/>`,
  };
}

/** 本体の筆 */
export const INK_PEN = pen(TONE, INK);
/** 影の筆。同じ形を一段だけずらして落とす（ぼかさない） */
export const SHADOW_PEN = pen(INK, INK);
