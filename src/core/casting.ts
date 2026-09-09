import type { AdvisorInfo, Choice } from './schema';
import { pickSome, shuffled, type Rng } from './rng';
import { CANDIDATE_COUNT, SLOTS_MAX, SLOTS_MIN, liarCountFor } from './limits';

/**
 * 発言枠と嘘つきの配役、そして誰が何を知っているか。
 * 配信（数千人）と友達内（4〜8人）で分岐させない。人数から自動で決まる。
 */

export type SelectionMode = 'lottery' | 'nominate';

export interface Casting {
  speakerIds: readonly string[];
  liarIds: readonly string[];
}

/** 助言者ひとりに配られる知識 */
export type Knowledge =
  /** 嘘つきは正解を正確に知っている */
  | { kind: 'liar'; correct: string }
  /** 協力者は「このどれかが生きる」までしか知らない */
  | { kind: 'honest'; candidates: readonly string[] };

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
export function castLiars(speakerIds: readonly string[], rng: Rng): readonly string[] {
  return drawLiars(speakerIds, liarCountFor(speakerIds.length), rng);
}

/**
 * 誰が何を知っているかを配る。
 * 正解が入るのは嘘つきの手元と、協力者の候補の中だけ。
 */
export function dealKnowledge(
  choices: readonly Choice[],
  correct: string,
  casting: Casting,
  rng: Rng,
  candidateCount: number = CANDIDATE_COUNT,
): Map<string, Knowledge> {
  const wrong = choices.filter((c) => c.id !== correct).map((c) => c.id);
  const out = new Map<string, Knowledge>();

  for (const id of casting.speakerIds) {
    if (casting.liarIds.includes(id)) {
      out.set(id, { kind: 'liar', correct });
      continue;
    }
    // 正解は必ず入れる。残りは外れから埋める
    const decoys = pickSome(wrong, Math.max(0, candidateCount - 1), rng);
    out.set(id, { kind: 'honest', candidates: shuffled([correct, ...decoys], rng) });
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
