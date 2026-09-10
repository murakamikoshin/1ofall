import type { AdvisorInfo, Choice, Knowledge } from './schema';
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
 *
 * 全員挑戦者モードの嘘つき（trapper）だけは、どれが死ぬかは知っていても
 * 正解は知らない。正解まで知らせると一度も死なないので、8部屋で丸わかりになる。
 *
 * 形そのものは schema.ts の KnowledgeSchema が正。ネットワーク越しに
 * 同じものを送るので、型と検証を二重管理しないためにあちらへ寄せてある。
 */
export type { Knowledge };

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
  /**
   * 抽選の重み。手を挙げた人・賭けを当てている人を厚く引くために使う。
   * 無ければ均等に引く
   */
  weight?: ((id: string) => number) | undefined;
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
  /**
   * 抽選。ただし**手を挙げた人を厚く引く。**
   *
   * ここまで `立候補する` の押し心地は嘘だった。指名方式のときだけ
   * volunteers を見ていて、既定の抽選では一切見ていなかったので、
   * **押しても何も起きないボタン**だった。配信で発言できない99%に
   * 渡してある手が二つ（賭けと立候補）あって、片方が死んでいた。
   *
   * 確定枠にはしない。手を挙げた人だけで埋めると、
   * 「見ているだけの人」が永久に上がれなくなる（挙げるのは一部）。
   * 重みで効かせて、挙げていない人にも席が回る。
   */
  const weight = input.weight;
  if (!weight) return pickSome(ids, slots, rng);
  return drawWeighted(ids, slots, weight, rng);
}

/**
 * 重み付きの抽選（重複なし）。
 * 重みは 0 より大きい値。大きいほど選ばれやすい。
 */
function drawWeighted(
  ids: readonly string[],
  count: number,
  weight: (id: string) => number,
  rng: Rng,
): string[] {
  const pool = [...ids];
  const out: string[] = [];
  const n = Math.max(0, Math.min(count, pool.length));
  for (let k = 0; k < n; k++) {
    let total = 0;
    for (const id of pool) total += Math.max(0.01, weight(id));
    let roll = rng() * total;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= Math.max(0.01, weight(pool[i] as string));
      if (roll <= 0) { picked = i; break; }
    }
    out.push(pool[picked] as string);
    pool.splice(picked, 1);
  }
  return out;
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
 * 区画のどこで裏切るか。**人ごとに決まっていて、区画のあいだ変わらない。**
 *
 * これまで嘘つきの正直さは毎部屋のコイン投げだった。平均すると同じでも、
 * 投げ続けると記録は「だいたい半分外す」に落ち着き、4部屋目には
 * 嘘つきと協力者の記録が割れきってしまう。一周書き出して読んだら、
 * 後半は一番上に乗るだけになっていた（正7 嘘0 と 正1 嘘5 が並ぶ）。
 * 実測でも、後半は**安全になるだけで深くならなかった**
 * （1部屋目 生存 71.9% → 6部屋目 84.4%、読みしろはどちらも 6pt 前後で横ばい）。
 * 死ぬのは霧の中の前半で、読みが積まれた後半は消化試合。順番が逆だった。
 *
 * 同じ正直さを**まとめて前に置く。** 裏切る点までは本当のことを言い、
 * そこから先は罠へ誘う。総量は変えないので均衡は動かないが、
 * 「ずっと当たっていた奴に、ここぞで殺される」が起こり得るようになる。
 *
 * 裏切る点は id から決まる。早い者が多く、遅い者は少ない（t の二乗）。
 * **長い仕込みは稀であるべき**で、毎回起きたら「後半は誰も信じない」で済む。
 */
export function betrayAt(advisorId: string, rooms: number): number {
  const bias = liarBias(advisorId);
  // liarBias は 0.35〜2.4 に散る。0〜1 に均す
  const t = Math.min(1, Math.max(0, (bias - 0.35) / 2.05));
  // 二乗で前に寄せる。平均すると区画の3分の1が「信用を作る側」になる
  return Math.round(t * t * rooms);
}

/**
 * 裏切る前と後の正直さ。
 *
 * **どちらも振り切らせない。** 前を 1.0 にすると区画の頭が
 * 全員正直な部屋になり、数えるだけで 89.6% 通ってしまった。
 * 後を 0 にすると後半が総崩れで、崖っぷちの生存が 54% まで落ちた。
 * 0.70 / 0.06 だと区画を通した平均が、これまでの実効値とほぼ同じになる。
 */
const HONEST_BEFORE = 0.7;
const HONEST_AFTER = 0.12;

/*
 * 0.70 / 0.06 だと後半が総崩れで、通常の踏破率が 1.0% まで落ちた
 * （終わりの画面に辿り着けない）。0.12 に緩めて、区画の長さと命で釣り合わせた。
 * このとき通常の腕の差は 14.9pt → 12.7pt に下がるが、基準（8pt）の1.5倍はある。
 */

/** その部屋で、この嘘つきが本当のことを言う確率 */
export function liarHonestyAt(advisorId: string, roomInSection: number, rooms: number): number {
  return roomInSection < betrayAt(advisorId, rooms) ? HONEST_BEFORE : HONEST_AFTER;
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
/**
 * 発言枠の外にいる助言者にも、同じ形の知識を配る。
 *
 * 「見えているのに言えない」がこのゲームの手触りの芯なので、
 * 枠外の人の画面が空だと成立しない。
 *
 * **勝敗には一切効かない。** 枠外の助言は挑戦者に届かないし、
 * 発言枠は区画のあいだ動かないので、ここで配ったものが
 * あとから盤面に混ざることもない。
 * だから乱数も本編とは別に持つ（本編の目が動くと均衡が変わる）。
 */
export function dealAudienceKnowledge(
  choices: readonly Choice[],
  correct: string,
  trap: string,
  audienceIds: readonly string[],
  rng: Rng,
  mix: KnowledgeMix = { narrow2: 0.5, narrow3: 0.25, doomed: 0.25 },
  liarFraction = 0.5,
  trapperLiars = false,
): Map<string, Knowledge> {
  const wrong = choices.filter((c) => c.id !== correct).map((c) => c.id);
  const out = new Map<string, Knowledge>();
  const total = mix.narrow2 + mix.narrow3 + mix.doomed;

  for (const id of audienceIds) {
    if (rng() < liarFraction) {
      out.set(id, trapperLiars ? { kind: 'trapper', trap } : { kind: 'liar', correct, trap });
      continue;
    }
    const roll = rng() * total;
    if (roll < mix.narrow2) {
      out.set(id, { kind: 'honest', candidates: shuffled([correct, ...pickSome(wrong, 1, rng)], rng) });
    } else if (roll < mix.narrow2 + mix.narrow3) {
      out.set(id, { kind: 'honest', candidates: shuffled([correct, ...pickSome(wrong, 2, rng)], rng) });
    } else {
      out.set(id, { kind: 'doomed', doomed: pickSome(wrong, 1, rng)[0] as string });
    }
  }
  return out;
}

export function dealOwnKnowledge(
  choices: readonly Choice[],
  correct: string,
  count: number,
  rng: Rng,
): readonly string[] {
  const wrong = choices.filter((c) => c.id !== correct).map((c) => c.id);
  return shuffled([correct, ...pickSome(wrong, Math.max(0, count - 1), rng)], rng);
}
