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

export interface WriteOptions {
  choices: readonly Choice[];
  knowledge: Knowledge;
  rng: Rng;
  /** 嘘つきが本当のことを言って信用を作りにいく確率 */
  liarHonestyRate?: number;
}

/**
 * 知識に沿った一文を書く。
 * 嘘つきは「外れを押す」か「本当のことを言って信用を作る」かを選べる。
 * ここぞで裏切るには、それまで信用されている必要がある。
 */
export function writeHint({ choices, knowledge, rng, liarHonestyRate = 0.35 }: WriteOptions): string {
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
    const victim = wrong[Math.floor(rng() * wrong.length)];
    const label = victim ? localized(victim.label) : '';
    // 嘘つきは正解を知っているので言い切れる
    return trySh(PUSH, label, rng) ?? trySh(HEDGE, label, rng) ?? label;
  }

  // 協力者。二択までしか絞れていないので、賭けるか、迷いを見せるか
  const [first, second] = knowledge.candidates;
  const a = labelOf(choices, first ?? '');
  const b = second ? labelOf(choices, second) : '';

  if (b && rng() < 0.5) {
    const narrowed = writeNarrow(a, b, rng);
    if (narrowed) return narrowed;
  }
  const bet = rng() < 0.5 ? a : b || a;
  return trySh(HEDGE, bet, rng) ?? trySh(PUSH, bet, rng) ?? bet;
}

function writeNarrow(a: string, b: string, rng: Rng): string | null {
  if (!a || !b) return null;
  for (const shape of NARROW.slice().sort(() => rng() - 0.5)) {
    const text = fit(shape(a, b));
    if (text) return text;
  }
  return null;
}
