import type { Choice } from './schema';
import { HINT_MAX_LENGTH } from './limits';
import type { Rng } from './rng';

/**
 * 助言の文面を組み立てる。
 *
 * 人間の助言者は自由に書くが、AI助言者（ソロモード）と、
 * 荒らし対策の文字数検査でここを共有する。
 * 20文字に収まらない言い回しは選ばない。
 */

type Shape = (label: string) => string;

/** 「これだ」と押す言い方 */
const PUSH: Shape[] = [
  (l) => `${l}だ`,
  (l) => `${l}にしろ`,
  (l) => `${l}が生きる`,
  (l) => `${l}で間違いない`,
  (l) => `迷うな、${l}`,
  (l) => `${l}以外は死ぬ`,
];

/** 「これは避けろ」と外す言い方 */
const AVOID: Shape[] = [
  (l) => `${l}はやめろ`,
  (l) => `${l}は罠だ`,
  (l) => `${l}に手を出すな`,
  (l) => `${l}で死ぬぞ`,
];

/** 断定を避けた言い方。読み手に迷いを残す */
const HEDGE: Shape[] = [
  (l) => `たぶん${l}`,
  (l) => `${l}に見える`,
  (l) => `${l}じゃないか`,
];

function fit(text: string): string | null {
  return [...text].length <= HINT_MAX_LENGTH ? text : null;
}

function tryShapes(shapes: readonly Shape[], label: string, rng: Rng): string | null {
  const order = shapes.slice().sort(() => rng() - 0.5);
  for (const shape of order) {
    const text = fit(shape(label));
    if (text) return text;
  }
  return null;
}

export interface WriteOptions {
  choices: readonly Choice[];
  /** 助言者が挑戦者に選ばせたい選択肢 */
  target: string;
  rng: Rng;
}

/**
 * target を選ばせるための一文を書く。
 * 「target を押す」か「target 以外のどれかを外す」かのどちらかになる。
 */
export function writeHint({ choices, target, rng }: WriteOptions): string {
  const aim = choices.find((c) => c.id === target);
  const others = choices.filter((c) => c.id !== target);
  const roll = rng();

  if (aim && roll < 0.62) {
    const text = tryShapes(PUSH, aim.label, rng);
    if (text) return text;
  }
  if (aim && roll < 0.84) {
    const text = tryShapes(HEDGE, aim.label, rng);
    if (text) return text;
  }
  // 外しに回る。2択まで絞れていない限り、決め手にはならない言い方
  const victim = others[Math.floor(rng() * others.length)];
  if (victim) {
    const text = tryShapes(AVOID, victim.label, rng);
    if (text) return text;
  }
  return aim ? (fit(aim.label) ?? 'これだ') : 'わからない';
}
