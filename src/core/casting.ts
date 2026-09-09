import type { AdvisorInfo, Choice } from './schema';
import { pickSome, shuffled, type Rng } from './rng';
import { SLOTS_MAX, SLOTS_MIN, liarCountFor } from './limits';

/**
 * 発言枠と嘘つきの配役、そして誰が何を知っているか。
 * 配信（数千人）と友達内（4〜8人）で分岐させない。人数から自動で決まる。
 */

export type SelectionMode = 'lottery' | 'nominate';

export interface Casting {
  speakerIds: readonly string[];
  liarIds: readonly string[];
}

/**
 * 助言者ひとりに配られる知識。
 *
 * 協力者のあいだでも知っていることの「形」が違う。
 *   目利き（二択）  正解を二つまで絞れている
 *   半可通（三択）  三つまで
 *   耳打ち          「これは死ぬ」を一つだけ知っている
 *
 * 混ぜると読みの差が広がる（素朴な読み 66.3% / 設計どおりの読み 82.8%。
 * 全員が二択だと 83.1% / 92.8% で、差が9.6ptしか出ない）。
 *
 * ただし「何も知らない者」は入れない。半分入れると61%まで落ち、
 * 落ちたぶんがそのまま運になる（tools/sim15.mjs）。
 */
export type Knowledge =
  /**
   * 嘘つきは正解を知っていて、さらに「罠」を見ている。
   * 罠は嘘つき全員に共通。ここへ誘い込むのが仕事。
   *
   * 罠を共通にしないと、嘘つきの嘘が外れの数だけ散る。
   * 散った嘘は集計で消えるので、正直者の声だけが集まって
   * 「一番多く名前が挙がったものを選ぶ」で必ず当たってしまう。
   */
  | { kind: 'liar'; correct: string; trap: string }
  /** 協力者。正解はこの中にある、というところまで */
  | { kind: 'honest'; candidates: readonly string[] }
  /** 協力者。これが死ぬ、ということだけ知っている */
  | { kind: 'doomed'; doomed: string }
  /**
   * 全員挑戦者のときの嘘つき。
   * どれが死ぬかは知っているが、正解は知らない。
   * 正解まで知らせると一度も死なないので、8部屋で丸わかりになる。
   */
  | { kind: 'trapper'; trap: string };

export function clampSlots(slots: number): number {
  if (!Number.isFinite(slots)) return SLOTS_MIN;
  return Math.min(SLOTS_MAX, Math.max(SLOTS_MIN, Math.round(slots)));
}

export interface SpeakerInput {
  advisors: readonly AdvisorInfo[];
  slots: number;
  mode: SelectionMode;
  volunteers?: readonly string[];
  nominated?: readonly string[];
  rng: Rng;
}

/**
 * 発言枠を選ぶ。
 * 助言者が枠以下（友達モード）なら全員。人数に応じて自動調整する。
 */
export function castSpeakers(input: SpeakerInput): readonly string[] {
  const { advisors, mode, rng } = input;
  const slots = clampSlots(input.slots);
  const ids = advisors.map((a) => a.id);
  if (ids.length <= slots) return ids;

  if (mode === 'nominate') {
    const nominated = (input.nominated ?? []).filter((id) => ids.includes(id));
    const pool = (input.volunteers ?? []).filter((id) => !nominated.includes(id) && ids.includes(id));
    const chosen = [...nominated, ...pickSome(pool, slots - nominated.length, rng)];
    if (chosen.length < slots) {
      chosen.push(...pickSome(ids.filter((id) => !chosen.includes(id)), slots - chosen.length, rng));
    }
    return chosen;
  }
  return pickSome(ids, slots, rng);
}

/**
 * 嘘つきを選ぶ。
 *
 * 区画のあいだ固定する。毎部屋引き直すと、
 * 「ずっと本当のことを言って信用を作り、ここぞで裏切る」が起こり得ない。
 * 過去の当たり外れの記録も、引き直していては何も予測しない飾りになる。
 *
 * 固定しても読み切られないのは、協力者自身が正解を知らず本当に迷っているため。
 * 嘘つきは迷ったふりに紛れられる（実測：区画6部屋を通して 78% → 84%。
 * 読みは効くが、割れて終わりにはならない）。
 */
export function castLiars(
  speakerIds: readonly string[],
  rng: Rng,
  loneHonest = false,
): readonly string[] {
  // 崖っぷち：正直者はただ一人。残りは全員嘘つき
  if (loneHonest) {
    const spared = pickSome(speakerIds, 1, rng)[0];
    return speakerIds.filter((id) => id !== spared);
  }
  return drawLiars(speakerIds, liarCountFor(speakerIds.length), rng);
}

/**
 * 誰が何を知っているかを配る。
 * 正解が入るのは嘘つきの手元と、協力者の候補の中だけ。
 */
/** 協力者の知識の配り方。区画ごとに割合を変えて難度を作る */
export interface KnowledgeMix {
  /** 二択まで絞れている者の割合 */
  narrow2: number;
  /** 三択まで絞れている者の割合 */
  narrow3: number;
  /** 「これは死ぬ」だけ知っている者の割合 */
  doomed: number;
}

export function dealKnowledge(
  choices: readonly Choice[],
  correct: string,
  casting: Casting,
  rng: Rng,
  mix: KnowledgeMix = { narrow2: 0.5, narrow3: 0.25, doomed: 0.25 },
  /** 崖っぷち：ただ一人の正直者は正解を正確に知っている */
  loneHonest = false,
  /** 全員挑戦者：嘘つきは正解ではなく罠だけを知る */
  trapperLiars = false,
): Map<string, Knowledge> {
  const wrong = choices.filter((c) => c.id !== correct).map((c) => c.id);
  const out = new Map<string, Knowledge>();
  const total = mix.narrow2 + mix.narrow3 + mix.doomed;

  // その部屋の罠。嘘つき全員がここへ誘う
  const trap = pickSome(wrong, 1, rng)[0] as string;

  for (const id of casting.speakerIds) {
    if (casting.liarIds.includes(id)) {
      out.set(id, trapperLiars ? { kind: 'trapper', trap } : { kind: 'liar', correct, trap });
      continue;
    }

    if (loneHonest) {
      // 見つけてもらえれば助かる。そのために正確に知っている必要がある
      out.set(id, { kind: 'honest', candidates: [correct] });
      continue;
    }

    const roll = rng() * total;
    if (roll < mix.narrow2 || wrong.length < 2) {
      out.set(id, { kind: 'honest', candidates: shuffled([correct, ...pickSome(wrong, 1, rng)], rng) });
    } else if (roll < mix.narrow2 + mix.narrow3) {
      out.set(id, { kind: 'honest', candidates: shuffled([correct, ...pickSome(wrong, 2, rng)], rng) });
    } else {
      out.set(id, { kind: 'doomed', doomed: pickSome(wrong, 1, rng)[0] as string });
    }
  }
  return out;
}

/**
 * 嘘つきの出やすさの癖。id から決まるので、同じ人はいつも同じ癖を持つ。
 * よく裏切る常連と、めったに裏切らない常連が自然に生まれる。
 */
export function liarBias(advisorId: string): number {
  let h = 2166136261;
  for (let i = 0; i < advisorId.length; i++) {
    h ^= advisorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.35 + ((h >>> 0) % 1000) / 1000 * 2.05;
}

function drawLiars(speakerIds: readonly string[], count: number, rng: Rng): string[] {
  const pool = shuffled(speakerIds, rng);
  const picked: string[] = [];
  const weights = new Map(pool.map((id) => [id, liarBias(id)]));

  for (let n = 0; n < count && picked.length < pool.length; n++) {
    const rest = pool.filter((id) => !picked.includes(id));
    const total = rest.reduce((s, id) => s + (weights.get(id) ?? 1), 0);
    let r = rng() * total;
    for (const id of rest) {
      r -= weights.get(id) ?? 1;
      if (r <= 0) { picked.push(id); break; }
    }
    if (picked.length === n) picked.push(rest[0] as string);
  }
  return picked;
}


/**
 * 挑戦者自身に配る部分情報。全員挑戦者モードで使う。
 * 全員を疑っても手詰まりにならないための最低限の足場。
 */
export function dealOwnKnowledge(
  choices: readonly Choice[],
  correct: string,
  count: number,
  rng: Rng,
): readonly string[] {
  const wrong = choices.filter((c) => c.id !== correct).map((c) => c.id);
  return shuffled([correct, ...pickSome(wrong, Math.max(0, count - 1), rng)], rng);
}
