import type { Choice } from './schema';
import { strings, getLocale } from '../i18n';
import { HINT_LIMIT_BY_LOCALE } from '../i18n/locales';
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

/** 言語ごとの上限。英語のラベルは長いので枠が要る */
const limit = (): number => HINT_LIMIT_BY_LOCALE[getLocale()] ?? 20;

const fit = (text: string): string | null => ([...text].length <= limit() ? text : null);

/**
 * 言い回しを選ぶ。**人ごとに癖が出る順で試す。**
 *
 * 毎回でたらめに選んでいたので、8人いる部屋で
 * 「香の煙で間違いない」が三人から同じ文面で出ていた。
 * 同じことを言っていても言い方が違えば「人」に見えるし、
 * いつもの言い方が崩れたときに引っかかる余地も生まれる。
 */
function trySh(shapes: readonly Shape[], label: string, rng: Rng, seat = -1): string | null {
  const order =
    seat < 0
      ? [...shapes].sort(() => rng() - 0.5)
      : orderFor(shapes, seat, rng);
  for (const shape of order) {
    const text = fit(shape(label));
    if (text) return text;
  }
  return null;
}

function orderFor(shapes: readonly Shape[], seat: number, rng: Rng): Shape[] {
  const n = shapes.length;
  // たまに二番目の言い回しに寄る。毎回一字一句同じだとそれはそれで機械に見える
  const start = (seat + (rng() < 0.25 ? 1 : 0)) % n;
  return Array.from({ length: n }, (_, i) => shapes[(start + i) % n] as Shape);
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
  /** 言い回しの癖。どの型から使うか。人ごとに固定 */
  seat: number;
}

export const DEFAULT_VOICE: Voice = { assertive: 0.5, narrows: 0.5, seat: -1 };

/** id から決まるので、同じ人はいつも同じ喋り方をする */
export function voiceOf(advisorId: string): Voice {
  let h = 2166136261;
  for (let i = 0; i < advisorId.length; i++) {
    h ^= advisorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  return { assertive: 0.15 + a * 0.7, narrows: 0.25 + b * 0.55, seat: (h >>> 20) % 997 };
}

export interface WriteOptions {
  choices: readonly Choice[];
  knowledge: Knowledge;
  rng: Rng;
  /** 嘘つきが本当のことを言って信用を作りにいく確率 */
  liarHonestyRate?: number;
  /**
   * 嘘つきが「迷ったふり」をする確率。
   * 外れ二つを挙げて「AかBのどっちか」と言う。
   * これが無いと、二つ挙げている人＝正直者、と機械的に決まってしまう。
   */
  liarMimicRate?: number;
  /** 話し方の癖 */
  voice?: Voice;
}

/**
 * 知識に沿った一文を書く。
 * 嘘つきは「外れを押す」か「本当のことを言って信用を作る」かを選べる。
 * ここぞで裏切るには、それまで信用されている必要がある。
 */
export function writeHint({
  choices, knowledge, rng, liarHonestyRate = 0.35, liarMimicRate = 0.25, voice = DEFAULT_VOICE,
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
      return trySh(strings().hints.hedge, a, rng, voice.seat) ?? a;
    }
    // 迷ったふり。外れ二つを挙げて、絞れていない協力者に見せかける
    if (rng() < liarMimicRate) {
      const a = labelOf(choices, knowledge.trap);
      const other = wrong.filter((c) => c.id !== knowledge.trap);
      const b = other.length ? localized((other[Math.floor(rng() * other.length)] as Choice).label) : '';
      const narrowed = writeNarrow(a, b, rng);
      if (narrowed) return narrowed;
    }
    // 耳打ちのふりをして正解を「死ぬ」と潰す
    if (rng() < 0.25) {
      const label = labelOf(choices, knowledge.correct);
      return trySh(strings().hints.avoid, label, rng, voice.seat) ?? `${label}はだめだ`;
    }
    // 罠へ誘う。嘘つき全員が同じ罠を見ているので、ここで力が集まる
    const label = labelOf(choices, knowledge.trap);
    const shapes = rng() < voice.assertive ? strings().hints.push : strings().hints.hedge;
    return trySh(shapes, label, rng, voice.seat) ?? trySh(strings().hints.hedge, label, rng, voice.seat) ?? label;
  }

  if (knowledge.kind === 'trapper') {
    // 罠しか知らない。罠へ誘うか、罠を避けろと言って信用を作るか
    const label = labelOf(choices, knowledge.trap);
    if (rng() < liarHonestyRate) {
      // 本当のことを言う回。罠を避けろ、は真実なので記録が良くなる
      return trySh(strings().hints.avoid, label, rng, voice.seat) ?? `${label}はだめだ`;
    }
    if (rng() < liarMimicRate) {
      const other = choices.filter((c) => c.id !== knowledge.trap);
      const b = other.length ? localized((other[Math.floor(rng() * other.length)] as Choice).label) : '';
      const narrowed = writeNarrow(label, b, rng);
      if (narrowed) return narrowed;
    }
    const shapes = rng() < voice.assertive ? strings().hints.push : strings().hints.hedge;
    return trySh(shapes, label, rng, voice.seat) ?? label;
  }

  if (knowledge.kind === 'doomed') {
    // 「これが死ぬ」ことしか知らない。潰すことしかできない
    const label = labelOf(choices, knowledge.doomed);
    return trySh(strings().hints.avoid, label, rng, voice.seat) ?? `${label}はだめだ`;
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
  const shapes = rng() < voice.assertive ? strings().hints.push : strings().hints.hedge;
  return trySh(shapes, bet, rng, voice.seat) ?? trySh(strings().hints.hedge, bet, rng, voice.seat) ?? bet;
}

function writeNarrow(a: string, b: string, rng: Rng): string | null {
  if (!a || !b) return null;
  for (const shape of [...strings().hints.narrow].sort(() => rng() - 0.5)) {
    const text = fit(shape(a, b));
    if (text) return text;
  }
  return null;
}
