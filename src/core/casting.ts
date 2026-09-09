import type { AdvisorInfo } from './schema';
import { pickSome, shuffled, type Rng } from './rng';
import { SLOTS_MAX, SLOTS_MIN, liarRangeFor } from './limits';

/**
 * 発言枠と嘘つきの配役。
 * 配信（数千人）と友達内（4〜8人）で分岐させない。人数から自動で決まる。
 */

export type SelectionMode = 'lottery' | 'nominate';

export interface CastingInput {
  advisors: readonly AdvisorInfo[];
  /** 挑戦者が設定する発言枠（3〜10）。実質的な難易度スライダー */
  slots: number;
  mode: SelectionMode;
  /** 指名方式で立候補した助言者 */
  volunteers?: readonly string[];
  /** 指名方式で挑戦者が直接選んだ助言者 */
  nominated?: readonly string[];
  rng: Rng;
}

export interface Casting {
  speakerIds: readonly string[];
  liarIds: readonly string[];
}

export function clampSlots(slots: number): number {
  if (!Number.isFinite(slots)) return SLOTS_MIN;
  return Math.min(SLOTS_MAX, Math.max(SLOTS_MIN, Math.round(slots)));
}

export function castRound(input: CastingInput): Casting {
  const { advisors, mode, rng } = input;
  const alive = advisors.filter((a) => !!a.id);
  const slots = clampSlots(input.slots);

  // 助言者が枠以下（友達モード）なら全員が発言枠。人数に応じて自動調整する。
  let speakerIds: string[];
  if (alive.length <= slots) {
    speakerIds = alive.map((a) => a.id);
  } else if (mode === 'nominate') {
    const nominated = (input.nominated ?? []).filter((id) => alive.some((a) => a.id === id));
    const pool = (input.volunteers ?? []).filter(
      (id) => !nominated.includes(id) && alive.some((a) => a.id === id),
    );
    const fromVolunteers = pickSome(pool, slots - nominated.length, rng);
    speakerIds = [...nominated, ...fromVolunteers];
    // 立候補が枠に足りない分は抽選で埋める（枠が空くと発言が薄くなる）
    if (speakerIds.length < slots) {
      const rest = alive.map((a) => a.id).filter((id) => !speakerIds.includes(id));
      speakerIds.push(...pickSome(rest, slots - speakerIds.length, rng));
    }
  } else {
    speakerIds = pickSome(
      alive.map((a) => a.id),
      slots,
      rng,
    );
  }

  // ラウンドごとに再抽選する（固定しない）。
  // ただし全員を等確率にすると、過去の記録が何も予測しない飾りになる。
  // 一人ひとりに嘘の出やすさの癖を持たせ、記録に弱い意味を持たせる。
  const liarIds = drawLiars(speakerIds, rollLiarCount(speakerIds.length, rng), rng);
  return { speakerIds, liarIds };
}

/** その部屋の嘘つきの人数を引く */
export function rollLiarCount(speakerCount: number, rng: Rng): number {
  const [lo, hi] = liarRangeFor(speakerCount);
  if (hi === lo) return lo;
  return rng() < 0.5 ? lo : hi;
}

/**
 * 嘘つきの出やすさの癖。id から決まるので、同じ人はいつも同じ癖を持つ。
 * 0.35〜2.4 倍。よく裏切る常連と、めったに裏切らない常連が自然に生まれる。
 * 確実ではないので、記録で読み切ることはできない。
 */
export function liarBias(advisorId: string): number {
  let h = 2166136261;
  for (let i = 0; i < advisorId.length; i++) {
    h ^= advisorId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.35 + ((h >>> 0) % 1000) / 1000 * 2.05;
}

/** 癖で重みをつけた抽選 */
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
