import { BOX, FINE_PEN, INK_PEN, PAPER, SHADOW_FINE, SHADOW_PEN, type Pen } from './style';
import { GENERIC_MARKS, MOTIFS, NONE_MOTIF, NOUNS } from './motifs';
import { bodyTransform, overlay, treatsFor } from './modifiers';

/**
 * 選択肢の絵を組む。**同じ引数なら必ず同じ絵**（生成AIのシード固定に当たる）。
 *
 * 組み方は四段。
 *   1. 札に物の名前があればその物を描く（「銭を出す」「鍵を出す」の部屋）
 *   2. 無ければ部屋の題材の形を描く（扉の部屋なら全枚数が扉）
 *   3. 札の形容を重ねる（破れた・濡れた・重い・取手のない…。多くて二つ）
 *   4. それでも差が付かないときだけ、順番から印を振る
 *
 * 影は本体と同じ形を右下に一段。背景は全枚数で同じ紙色。
 * 線幅・影・背景を絵ごとに変える口がそもそも無い（規約 §5 はここで守られる）。
 */

const cache = new Map<string, string>();

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hasMotif(theme: string): boolean {
  return theme in MOTIFS;
}

export const VARIANTS = 8;

/**
 * 題材そのものを指す語。札が題材の名前と違う言い方をすることがある。
 *
 * 「石段」は "Stone steps"。題材は `stair` なので `stair` の字が札に無く、
 * **石の形で描かれていた**（段ではなく石が並ぶ）。言い換えをここに書く。
 */
const OWN_WORDS: Record<string, readonly string[]> = {
  stair: ['steps', 'step', 'stairs'],
  stairwell: ['steps', 'flight'],
  step: ['threshold'],
  exit: ['mouth'],
  tunnel: ['hole'],
  path: ['track'],
  cloth: ['curtain', 'weave'],
  person: ['man', 'woman', 'child', 'seller'],
  guard: ['gatekeeper'],
};

/** 札の中の物の名前。長い語から当てる（「hand bell」を「hand」に取られないため） */
const NOUN_KEYS = Object.keys(NOUNS).sort((a, b) => b.length - a.length);

function nounIn(labelEn: string): string | null {
  const low = ` ${labelEn.toLowerCase().replace(/[^a-z\- ]/g, ' ')} `;
  for (const key of NOUN_KEYS) {
    if (low.includes(` ${key} `) || low.includes(` ${key}s `)) return key;
  }
  return null;
}

export interface ArtSpec {
  theme: string;
  /** 部屋の中での順番。同じ絵が二枚並ばないようにするため */
  index: number;
  /** 札（英語）。形容と物の名前をここから引く */
  labelEn?: string;
  /** 影の傾きを決める鍵 */
  key: string;
}

/**
 * 一枚ぶんを組む。**輪郭は太い筆、内側の印は細い筆。**
 *
 * 全部を同じ太さで引いていたら、印が輪郭と同じ重さで主張して形が読みにくかった。
 * 段は二つだけで、どの絵でも同じ割り当て（規約 §5 の「線の太さが揃っている」は
 * 絵ごとに変えないことを言っているので、役ごとの二段は外れない）。
 */
function compose(pen: Pen, fine: Pen, spec: ArtSpec): { body: string; scale: number; spin: number } {
  const motif = MOTIFS[spec.theme] ?? MOTIFS['box'];
  const label = spec.labelEn ?? '';
  const treats = treatsFor(label);
  /*
   * 物の名前から形を引く。ただし**題材そのものの名前が札にあるときは題材の形**。
   * 「桶を吊るした井戸」で桶を描いてしまい、井戸の部屋に桶が並んでいた。
   */
  const low = label.toLowerCase();
  /*
   * 選ばない札。部屋の物を描くと**選ぶ札と同じ絵になる。**
   * 「隠れない（You do not hide）」が樽の絵で、「樽の中」と並んでいた。
   * 物が別々の部屋（nouns）だけで見る（同じ物の形容が違う部屋には出てこない）。
   */
  const refuses = /^(nothing|nobody|none|neither)\b|^(you )?do not\b|^say nothing$|^not at all$/.test(low);
  if (motif?.nouns && refuses) {
    const marks = NONE_MOTIF.marks ?? [];
    const mark = marks.length > 0 ? marks[spec.index % marks.length] : undefined;
    return { body: NONE_MOTIF.base(pen) + (mark ? mark(fine) : ''), scale: 1, spin: 0 };
  }
  /*
   * 題材の名前が**場所として**出ているだけなら、それは題材の名指しではない。
   *
   * 「上段の壺（Jar on the top shelf）」は棚の絵で出ていた。棚の部屋で
   * 「shelf」が札に入っているので「札が題材そのものを名指している」と読み、
   * 壺を引くのをやめていた。棚は置き場所で、選ぶのは壺。
   * 英語は前置詞より前が中身なので、**前置詞の手前だけ**で名指しを見る。
   * （「水の匂う穴（Hole smelling of water）」は手前に hole が残るので穴のまま）
   */
  const head = low.split(/ (?:on|in|at|of|from|behind|under|near|by|inside|beneath) /)[0] ?? low;
  const ownName = head.includes(spec.theme.replace('_', ' '))
    || (OWN_WORDS[spec.theme] ?? []).some((w) => head.includes(w));
  const noun = label && !ownName && motif?.nouns ? (nounIn(head) ?? nounIn(label)) : null;
  const nounMotif = noun && NOUNS[noun] !== spec.theme ? MOTIFS[NOUNS[noun] as string] : undefined;
  const drawn = nounMotif ?? motif;
  if (!drawn) return { body: '', scale: 1, spin: 0 };

  let out = drawn.base(pen);
  const omitted = treats.includes('omit');
  if (drawn.detail && !omitted) out += drawn.detail(fine);
  for (const t of treats) out += overlay(fine, t);
  /*
   * 形容が当たらなかったときだけ、順番で印を振る。
   * **物の名前で引いたときも振る**——「木の梯子」と「縄の梯子」はどちらも
   * 梯子なので、印が無いと同じ絵になる。
   * 題材ごとの印が6種に足りないぶんは当たり障りのない印で埋める
   * （2種しか無い題材では 0番と2番が同じ絵になっていた）。
   */
  if (treats.length === 0) {
    const marks = [...(drawn.marks ?? []), ...GENERIC_MARKS].slice(0, VARIANTS);
    const mark = marks[spec.index % marks.length];
    if (mark) out += mark(fine);
  }
  const { scale, spin } = bodyTransform(treats);
  return { body: out, scale, spin };
}

export function artSvg(spec: ArtSpec): string {
  const top = compose(INK_PEN, FINE_PEN, spec);
  const shade = compose(SHADOW_PEN, SHADOW_FINE, spec);
  /*
   * 手の揺れ。±2度だけ（余白の量は変わらない）。
   *
   * `>> 5`（符号つき）で引いていたので、鍵が 2^31 を超えると負になり、
   * 揺れが -6〜+2 度になっていた。**どの絵も左へ寄っていた**（平均 -2度）。
   */
  const tilt = ((hash(spec.key) >>> 5) % 5) - 2 + top.spin;
  const inner = (content: string): string =>
    `<g transform="rotate(${tilt} 64 64) scale(${top.scale}) translate(${(64 * (1 - top.scale)) / top.scale} ${(64 * (1 - top.scale)) / top.scale})">${content}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">`
    + `<rect width="${BOX}" height="${BOX}" fill="${PAPER}"/>`
    + `<g transform="translate(4 5)" opacity="0.26">${inner(shade.body)}</g>`
    + inner(top.body)
    + `</svg>`
  );
}

export function artImage(spec: ArtSpec): string {
  const k = `${spec.theme}|${spec.key}|${spec.index}|${spec.labelEn ?? ''}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(spec))}`;
  cache.set(k, uri);
  return uri;
}

export function choiceArt(
  theme: string,
  roomId: string,
  choiceId: string,
  image?: string,
  index?: number,
  labelEn?: string,
): string {
  if (image && image.length > 0) return image;
  const spec: ArtSpec = {
    theme,
    index: index ?? hash(`${roomId}:${choiceId}`) % VARIANTS,
    key: `${roomId}:${choiceId}`,
    ...(labelEn ? { labelEn } : {}),
  };
  return artImage(spec);
}
