import type { Choice } from './schema';
import type { Knowledge } from './schema';
import { strings, localized } from '../i18n';

/**
 * 届いた助言の「読み方」。
 *
 * 大事なのは、**文面だけを見る**こと。
 * 誰が嘘つきかを覗いて決めると、AI の仲間だけが超能力を持つことになり、
 * 人間と同じ盤面を遊んでいないことになる。
 */

export interface HintRow {
  advisorId: string;
  text: string;
  /** この区画での当たり外れ。区画が変わると消える */
  record: { hit: number; miss: number };
}

export interface ReadInput {
  choices: readonly Choice[];
  rows: readonly HintRow[];
  /** 自分に配られたもの */
  own: Knowledge | null;
}

/** 当たり外れから見た、その人の信用（0.5 から始まる） */
export function trustOf(record: { hit: number; miss: number }): number {
  return (record.hit + 1) / (record.hit + record.miss + 2);
}

/**
 * 選択肢ごとの点。高いほど「通れそう」。
 *
 * 数えるだけだと嘘つきの声が数で勝つので、
 *  - 信用で重みを変える
 *  - 断言より迷いを重く見る（嘘つきは断言しがち）
 * の二つを入れてある。これは docs/RUBRIC.md でいう
 * 「迷いを信じ記録も見る」と同じ読み方。
 */
export function scoreChoices({ choices, rows, own }: ReadInput): Map<string, number> {
  const T = strings();
  const score = new Map(choices.map((c) => [c.id, 0]));
  const bump = (id: string, by: number): void => {
    score.set(id, (score.get(id) ?? 0) + by);
  };

  if (own?.kind === 'honest') for (const id of own.candidates) bump(id, 2.5);
  if (own?.kind === 'doomed') bump(own.doomed, -3);
  if (own?.kind === 'trapper') bump(own.trap, -99);
  if (own?.kind === 'liar') bump(own.correct, 99);

  for (const row of rows) {
    const weight = trustOf(row.record);
    const touched = choices.filter((c) => row.text.includes(localized(c.label)));
    if (touched.length === 0) continue;

    // 「これは死ぬ」型の助言は、指したものを下げる
    if (T.hints.avoidPattern.test(row.text)) {
      for (const c of touched) bump(c.id, -weight * 1.2);
      continue;
    }
    const hedging = touched.length >= 2 || T.hints.hedgePattern.test(row.text);
    for (const c of touched) bump(c.id, weight * (hedging ? 1.25 : 0.8));
  }

  return score;
}

/** 点が一番高いものを選ぶ。並んだら乱数で割る */
export function bestChoice(score: ReadonlyMap<string, number>, choices: readonly Choice[], rng: () => number): string {
  let best = -Infinity;
  for (const c of choices) best = Math.max(best, score.get(c.id) ?? 0);
  const top = choices.filter((c) => (score.get(c.id) ?? 0) === best);
  const picked = top[Math.floor(rng() * top.length)] ?? choices[0];
  return picked?.id ?? '';
}
