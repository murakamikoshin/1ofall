/**
 * 選択肢の絵の作り。**全枚数で同じ規約を、コードで守る。**
 *
 * `docs/IMAGE_STYLE.md` の規約（太い黒線・平らな塗り・影は右下に1段・
 * 背景は同色・正方形・中央・余白は均等）は、生成AIに守らせるための文章だった。
 * コードで描けば**守るのではなく、外せなくなる。**
 * 線幅も影も背景も、ここにしか無いので1枚だけ浮くことが起こらない。
 */

export const PAPER = '#c2b192';
export const INK = '#14100b';
/** 平らな塗り。**全枚数で一色**。絵によって色を変えると、それが手掛かりになる */
export const TONE = '#a29073';
/**
 * 奥まったところの塗り。**役で決まる**（穴の中・器の内側・窓の面）。
 *
 * 平らな塗り一色だと、穴が塗った丘に見え、器が板に見える。
 * 濃淡を二段にすると奥行きが出るが、**絵ごとに濃さを変えては駄目**で、
 * それをやると濃い絵が目立って手掛かりになる。役で決めるならその心配が無い。
 */
export const SHADE = '#85735a';

/** 128 の枠。書き出しは何倍でも効く（線の比は変わらない） */
export const BOX = 128;
/** 輪郭の線。全枚数で同じ */
export const STROKE = 7;
/**
 * 内側の線。輪郭より細い。
 *
 * 全部を同じ太さで引くと、印が輪郭と同じ重さで主張して形が読みにくい。
 * **太さの段は二つだけ**（輪郭と内側）で、どの絵でも同じ割り当てなので、
 * 「線の太さが10枚で揃っている」（規約 §5）は保たれる。
 */
export const STROKE_FINE = 5;

/** 描く道具。影の層と本体の層で同じ形を二度描くために、筆を差し替える */
export interface Pen {
  /** 塗って輪郭も引く */
  F(d: string): string;
  /** 奥まったところ（穴の中・器の内側）。濃い側で塗る */
  G(d: string): string;
  /** 線だけ */
  L(d: string): string;
  /** 点（目・釘・穴） */
  DOT(x: number, y: number, r?: number): string;
  /** 円（輪・玉） */
  C(cx: number, cy: number, r: number, filled?: boolean): string;
}

function pen(fill: string, shade: string, ink: string, width: number): Pen {
  const base = `stroke="${ink}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
  return {
    F: (d) => `<path d="${d}" fill="${fill}" ${base}/>`,
    G: (d) => `<path d="${d}" fill="${shade}" ${base}/>`,
    L: (d) => `<path d="${d}" fill="none" ${base}/>`,
    DOT: (x, y, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`,
    C: (cx, cy, r, filled = false) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${filled ? fill : 'none'}" ${base}/>`,
  };
}

/** 本体の筆（輪郭） */
export const INK_PEN = pen(TONE, SHADE, INK, STROKE);
/** 本体の筆（内側の印）。細い側 */
export const FINE_PEN = pen(TONE, SHADE, INK, STROKE_FINE);
/** 影の筆。同じ形を一段だけずらして落とす（ぼかさない） */
export const SHADOW_PEN = pen(INK, INK, INK, STROKE);
export const SHADOW_FINE = pen(INK, INK, INK, STROKE_FINE);
