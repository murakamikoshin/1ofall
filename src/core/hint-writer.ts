import type { Choice } from './schema';
import { HINT_MAX_LENGTH } from './limits';
import type { Knowledge } from './casting';
import type { Rng } from './rng';
import { localized } from '../i18n';

/**
 * 助言の文面を組み立てる。AI助言者（ソロ）が使う。
 *
 * 大事なのは「協力者は本当に迷っている」ことが文面に出ること。
 * 協力者は正解を知らないので断言できない。断言できるのは嘘つきだけ。
 * ここが挑戦者にとって唯一の手掛かりになる。
 */

type Shape = (label: string) => string;

/** 一つに賭けて押す言い方 */
const PUSH: Shape[] = [
  (l) => `${l}だ`,
  (l) => `${l}にしろ`,
  (l) => `${l}が生きる`,
  (l) => `${l}で間違いない`,
  (l) => `迷うな、${l}`,
];

/** 迷いを込めた言い方 */
const HEDGE: Shape[] = [
  (l) => `たぶん${l}`,
  (l) => `${l}に見える`,
  (l) => `${l}じゃないか`,
  (l) => `${l}な気がする`,
];

/** 「これは死ぬ」と伝える言い方 */
const AVOID: Shape[] = [
  (l) => `${l}はやめろ`,
  (l) => `${l}は死ぬ`,
  (l) => `${l}に手を出すな`,
  (l) => `${l}は罠だ`,
  (l) => `${l}だけは違う`,
];

/** 二つに絞れている、と伝える言い方 */
const NARROW: ((a: string, b: string) => string)[] = [
  (a, b) => `${a}か${b}のどっちか`,
  (a, b) => `${a}か${b}だ`,
  (a, b) => `${a}と${b}まで絞れた`,
  (a, b) => `${a}か${b}。決めきれん`,
];

const fit = (text: string): string | null => ([...text].length <= HINT_MAX_LENGTH ? text : null);

function trySh(shapes: readonly Shape[], label: string, rng: Rng): string | null {
  for (const shape of shapes.slice().sort(() => rng() - 0.5)) {
    const text = fit(shape(label));
    if (text) return text;
  }
  return null;
}

const labelOf = (choices: readonly Choice[], id: string): string => {
  const c = choices.find((x) => x.id === id);
  return c ? localized(c.label) : '';
};

/**
 * 話し方の癖。人ごとに固定する。
 *
 * これが無いと、全員が同じ調子で喋るので「人を読む」余地が生まれない。
 * 癖があると、いつも歯切れの悪い者が急に言い切ったときに引っかかる。
 */
export interface Voice {
  /** 言い切りやすさ。高いほど断言が多い */
  assertive: number;
  /** 二つ挙げて迷いを見せる率 */
  narrows: number;
}

export const DEFAULT_VOICE: Voice = { assertive: 0.5, narrows: 0.5 };

/** id から決まるので、同じ人はいつも同じ喋り方をする */
export function voiceOf(advisorId: string): Voice {
  let h = 2166136261;
  for (let i = 0; i < advisorId.length; i++) {
    h ^= advisorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return { assertive: 0.15 + a * 0.7, narrows: 0.25 + b * 0.55 };
}

export interface WriteOptions {
  choices: readonly Choice[];
  knowledge: Knowledge;
  rng: Rng;
  /** 嘘つきが本当のことを言って信用を作りにいく確率 */
  liarHonestyRate?: number;
  /** 話し方の癖 */
  voice?: Voice;
}

/**
 * 知識に沿った一文を書く。
 * 嘘つきは「外れを押す」か「本当のことを言って信用を作る」かを選べる。
 * ここぞで裏切るには、それまで信用されている必要がある。
 */
export function writeHint({
  choices, knowledge, rng, liarHonestyRate = 0.35, voice = DEFAULT_VOICE,
}: WriteOptions): string {
  if (knowledge.kind === 'liar') {
    const wrong = choices.filter((c) => c.id !== knowledge.correct);
    if (rng() < liarHonestyRate) {
      // 信用を作る回。正解を含む二択の形に紛れる
      const decoy = wrong[Math.floor(rng() * wrong.length)];
      const a = labelOf(choices, knowledge.correct);
      const b = decoy ? localized(decoy.label) : '';
      const narrowed = writeNarrow(a, b, rng);
      if (narrowed) return narrowed;
      return trySh(HEDGE, a, rng) ?? a;
    }
    // 嘘つきは正解を知っているので言い切れる。
    // 耳打ちのふりをして正解を「死ぬ」と潰すこともできる
    if (rng() < 0.3) {
      const label = labelOf(choices, knowledge.correct);
      return trySh(AVOID, label, rng) ?? `${label}はだめだ`;
    }
    const victim = wrong[Math.floor(rng() * wrong.length)];
    const label = victim ? localized(victim.label) : '';
    return trySh(PUSH, label, rng) ?? trySh(HEDGE, label, rng) ?? label;
  }

  if (knowledge.kind === 'doomed') {
    // 「これが死ぬ」ことしか知らない。潰すことしかできない
    const label = labelOf(choices, knowledge.doomed);
    return trySh(AVOID, label, rng) ?? `${label}はだめだ`;
  }

  // 協力者。絞れているところまでしか言えないので、賭けるか、迷いを見せるか
  const [first, second] = knowledge.candidates;
  const a = labelOf(choices, first ?? '');
  const b = second ? labelOf(choices, second) : '';

  // 三択まで絞れている場合は、二つ挙げて残りを匂わせるのが精一杯
  if (b && rng() < voice.narrows) {
    const narrowed = writeNarrow(a, b, rng);
    if (narrowed) return narrowed;
  }
  const bet = rng() < 0.5 ? a : b || a;
  // 言い切りやすい者は、絞れていなくても言い切ってしまう
  const shapes = rng() < voice.assertive ? PUSH : HEDGE;
  return trySh(shapes, bet, rng) ?? trySh(HEDGE, bet, rng) ?? bet;
}

function writeNarrow(a: string, b: string, rng: Rng): string | null {
  if (!a || !b) return null;
  for (const shape of NARROW.slice().sort(() => rng() - 0.5)) {
    const text = fit(shape(a, b));
    if (text) return text;
  }
  return null;
}
