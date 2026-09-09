/**
 * 数値の制約だけを置く。zod を持たない。
 * 助言者ページはここだけを読む（検証ライブラリを初期表示の経路に載せない）。
 */
export const HINT_MAX_LENGTH = 20;
export const ADVISOR_NAME_MAX = 12;
export const ROOM_CODE_LENGTH = 6;
export const SLOTS_MIN = 3;
export const SLOTS_MAX = 10;

/** 1周の骨格。ここを動かすと1周の長さが変わる */
export const RUN = {
  lives: 4,
  sections: 4,
  roomsPerSection: 6,
  baseTimeMs: 60_000,
  penaltyTimeMs: 15_000,
  /** 区画ごとの発言枠。狭いほど嘘の破壊力が上がる */
  slotsBySection: [8, 7, 6, 5],
  /** 区画ごとに、これ以上の択がある部屋を優先して出す */
  minChoicesBySection: [5, 5, 6, 6],
} as const;

/**
 * 嘘つきの人数の幅。
 *
 * 人数を固定すると、発言枠が5人か6人かで生存率が90%と78%に割れる（段差が出る）。
 * 部屋ごとに1〜2人で揺らすと段差がならされ、
 * さらに「今回は何人いるのか分からない」という不確かさが乗る。
 * 挑戦者には正確な人数を知らせない（知らせると2人未満だと分かった時点で安全になる）。
 */
export function liarRangeFor(speakerCount: number): readonly [number, number] {
  if (speakerCount <= 1) return [0, 0];
  if (speakerCount <= 2) return [1, 1];
  if (speakerCount <= 3) return [1, 1];
  if (speakerCount <= 5) return [1, 2];
  return [2, 2];
}

/**
 * 挑戦者が開ける助言の数。
 *
 * ここがこのゲームの要。全部の助言が見えると、多数決で必ず正解に辿り着けてしまう
 * （正直者は必ず過半を占めるため）。開ける数を絞ると、開いた中で嘘つきが
 * 過半を取れるようになり、初めて嘘に破壊力が出る。
 *
 * 3通に固定している。理由は二つ。
 *  - 嘘つき2人が開封の過半（2/3）を取れる最小の奇数であること
 *  - 実測で、発言枠3〜8人・嘘つき1〜2人のすべてで生存率が狙いの帯に入ること
 *    （tools/sim9.mjs。2通以下だと情報が足りず60%台、4通以上だと90%超で緩む）
 */
export const OPEN_LIMIT = 3;

export function openLimitFor(speakerCount: number): number {
  // 全部は見えない、という原則は人数がどれだけ少なくても破らない
  return Math.max(1, Math.min(OPEN_LIMIT, speakerCount - 1));
}
