import type { AdvisorInfo } from './schema';
import { pickSome, type Rng } from './rng';
import { SLOTS_MAX, SLOTS_MIN } from './limits';

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

/**
 * 嘘つきは発言枠の中に1〜2人。
 * 枠が3人しかいない状況で2人が嘘つきだと読み合いが成立しないため、
 * 枠が5人以上のときだけ2人目が出る。
 */
export function liarCountFor(speakerCount: number, rng: Rng): number {
  if (speakerCount <= 2) return speakerCount >= 1 ? 1 : 0;
  if (speakerCount < 5) return 1;
  return rng() < 0.45 ? 2 : 1;
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

  // ラウンドごとに再抽選する（固定しない）
  const liarIds = pickSome(speakerIds, liarCountFor(speakerIds.length, rng), rng);
  return { speakerIds, liarIds };
}
