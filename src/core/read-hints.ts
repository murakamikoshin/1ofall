import type { Choice } from './schema';
import type { Knowledge } from './schema';
import { strings, localized } from '../i18n';
import { readCall } from './name-calling';

/**
 * 届いた助言の「読み方」。
 *
 * 大事なのは、**文面だけを見る**こと。
 * 誰が嘘つきかを覗いて決めると、AI の仲間だけが超能力を持つことになり、
 * 人間と同じ盤面を遊んでいないことになる。
 */

export interface HintRow {
  advisorId: string;
  /** 誰を指したかを読むのに要る */
  advisorName: string;
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

  /**
   * 人を指した助言を先に集める。
   *
   * 「ノブは嘘だ」は扉に触れていないので、そのままでは点にならない。
   * **指された側の重みを動かす**という形で効かせる。
   *
   * **向きは「撃たれた者を疑う」。** この読み方を使っているのは
   * 全員挑戦者の AI の仲間だけで（`party-engine.aiPicks`）、
   * そのモードでは裏切り者が正解を知らず**罠しか知らない**ので、
   * 撃つ先が「罠を押している者」に揃う。実測（tools/shot-probe.mjs、
   * 300種×4区画。撃たれた者が正解を口にしていた割合 − 撃たれていない者）。
   *
   *   全員挑戦者   1部屋目 -35.7pt  …  5部屋目 -42.5pt
   *   通常         1部屋目 -33.9pt  …  5部屋目  -9.6pt
   *   崖っぷち     1部屋目  -8.8pt  …  5部屋目 +30.0pt   ← ここだけ途中で逆を向く
   *
   * **前は「撃たれた者を信じる」だった。** 裏付けにしていた
   * tools/name-call.mjs の数字（一度撃たれた者 73.2% / 二度 97.7%）は、
   * 裏切りの段取り（区画の前半は裏切り者も本当のことを言い、指す先も
   * 仲間と同じ側に立つ）を入れずに測ったものだった。入れて測ると向きが変わる。
   *
   * 崖っぷちの奥だけは逆を向くので、**この読み方をそちらに繋ぐなら
   * 向きを選び直すこと**（部屋番号で切り替える形になる）。
   */
  const people = rows.map((r) => ({ id: r.advisorId, name: r.advisorName }));
  const called = new Map<string, number>();
  for (const row of rows) {
    if (choices.some((c) => row.text.includes(localized(c.label)))) continue;
    const call = readCall(row.text, people);
    if (!call || call.targetId === row.advisorId) continue;
    // **撃った側の信用では重み付けしない。** 撃たれた事実そのものが手掛かりで、
    // 誰に撃たれたかまで数えると、記録の重みを二度掛けることになる
    called.set(call.targetId, (called.get(call.targetId) ?? 0) + (call.doubt ? -1 : 0.5));
  }

  for (const row of rows) {
    const net = called.get(row.advisorId) ?? 0;
    // 撃たれた者の声を小さく、庇われた者の声を大きく。振り切らせない
    const weight = trustOf(row.record) * Math.max(0.2, Math.min(2.6, 1 + net * 0.9));
    const touched = choices.filter((c) => row.text.includes(localized(c.label)));
    if (touched.length === 0) continue;

    // 言い回しを見る前に、選択肢の名前そのものを外す。
    // 「動かない影」「A shadow that does not move」のように、
    // 名前の中に否定語が入っていると警告と読み違える
    let rest = row.text;
    for (const c of touched) rest = rest.split(localized(c.label)).join('　');

    // 「これは死ぬ」型の助言は、指したものを下げる
    if (T.hints.avoidPattern.test(rest)) {
      for (const c of touched) bump(c.id, -weight * 1.2);
      continue;
    }
    const hedging = touched.length >= 2 || T.hints.hedgePattern.test(rest);
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
