/**
 * 数値の制約と1周の骨格。zod を持たない。
 * 助言者ページはここだけを読む（検証ライブラリを初期表示の経路に載せない）。
 */
export const HINT_MAX_LENGTH = 20;
export const ADVISOR_NAME_MAX = 12;
export const ROOM_CODE_LENGTH = 6;
export const SLOTS_MIN = 3;
export const SLOTS_MAX = 10;

/** 1周の骨格 */
export const RUN = {
  lives: 4,
  sections: 4,
  roomsPerSection: 6,
  baseTimeMs: 60_000,
  penaltyTimeMs: 15_000,
  /**
   * 区画ごとの発言枠。狭いほど嘘が効く。
   * 最終区画だけ広がるのは、賭場中が見物に来るという理屈。
   * 人数が増えるぶん、協力者の絞り込みを二択から三択に落として難度を上げている。
   */
  slotsBySection: [8, 7, 6, 8],
  /** 区画ごとに、これ以上の択がある部屋を優先して出す */
  minChoicesBySection: [5, 6, 6, 6],
  /** 区画ごとに、協力者が正解を何択まで絞れているか。多いほど手掛かりが薄い */
  candidatesBySection: [2, 2, 2, 3],
} as const;

/**
 * 嘘つきの人数。
 * 発言枠が4人以下で2人だと、正直者が足りず読み合いにならない。
 */
export function liarCountFor(speakerCount: number): number {
  if (speakerCount <= 1) return 0;
  return speakerCount >= 5 ? 2 : 1;
}

/**
 * 協力者が正解を何択まで絞れているか。
 *
 * ここがこのゲームの心臓部。
 *
 * 初期の設計では協力者全員に正解を見せていた。この形は多数決で解けてしまう
 * （正直者は必ず過半を占めるので、一番多く名指しされたものを選べば必ず当たる。
 *  実測で全構成が生存率100%）。
 *
 * 次に「助言を伏せて数通だけ開かせる」形を試したが、これは運ゲーになる。
 * 誰を開くかを決める時点で判断材料が何も無く、読みは開いた後にしか働かないため。
 *
 * いまの形は、協力者に正解を教えない。「このどちらかが生きる」とだけ伝える。
 *  - 協力者は正解を名指しできないので、票が自然に割れて多数決が決め手にならない
 *  - 正解は全協力者の候補に必ず入るので、迷いの言葉まで読めば浮かび上がる
 *  - 断言できるのは正解を知っている嘘つきだけ ＝ 断言そのものが手掛かりになる
 *
 * 実測：素朴な多数決は38.8%、迷いまで読むと82.9%。読みの差が44ポイント出る。
 */
export const CANDIDATE_COUNT = 2;

export function candidatesForSection(sectionIndex: number): number {
  return RUN.candidatesBySection[sectionIndex] ?? CANDIDATE_COUNT;
}

/** 助言はすべて挑戦者に見える。伏せない（伏せると運ゲーになる） */
export const HINTS_ARE_VISIBLE = true;
