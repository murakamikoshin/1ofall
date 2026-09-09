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
  roomsPerSection: 8,
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
  /**
   * 区画ごとの、協力者の知識の配り方。
   * 先へ行くほど二択の目利きが減り、三択と耳打ちが増える＝助言が頼りなくなる。
   */
  knowledgeBySection: [
    { narrow2: 0.80, narrow3: 0.15, doomed: 0.05 },
    { narrow2: 0.70, narrow3: 0.20, doomed: 0.10 },
    { narrow2: 0.60, narrow3: 0.25, doomed: 0.15 },
    { narrow2: 0.45, narrow3: 0.30, doomed: 0.25 },
  ],
} as const;

/**
 * 嘘つきの割合と、嘘をつく頻度。
 *
 * 固定2人にしていたときは、正直者が必ず過半を占めるので
 * 「一番多く名前が挙がったものを選ぶ」だけで89%生き残れた。
 * 部屋の7割が一目で分かる確認作業になり、腕の差は0.6ポイントしか出なかった。
 *
 * 人数を区画ごとに振ってみたが、それでは変動が「区画ごと」にしか起きない。
 * 嘘つき1人の区画は6部屋まるごと確認作業になる。
 *
 * いまの形：**嘘つきを多めに配り、各自が毎回は嘘をつかない。**
 *  - 実際に嘘が出る人数が部屋ごとに変わる（0人の部屋も、4人の部屋もある）
 *  - 誰が嘘つきかは区画のあいだ変わらないので、記録が効く
 *  - 「ずっと本当を言って、ここぞで裏切る」がそのまま仕組みになる
 *
 * それでもまだ足りなかった。嘘つきの嘘が外れの数だけ散るので、
 * 散った嘘は集計で消え、正直者の声だけが集まってしまう。
 * そこで**嘘つき全員に同じ「罠」を見せて、嘘を1点に集める**（dealKnowledge）。
 *
 * 実測（区画1相当・発言8人）：
 *   数えるだけ         89% → 73%
 *   記録を読む         92% → 79%
 *   腕の差            +2.6pt → +6.3pt
 *   一番票が集まった選択肢の的中率  98% → 85%
 *
 * 最後の数字が要。**群れに従うと15%の確率で死ぬ。**
 * それまでは一番票が集まった選択肢が98%正解で、部屋の7割が確認作業だった。
 */
export const LIAR_FRACTION = 0.38;

/** 嘘つきが実際に嘘をつく確率。残りは信用を作る回 */
export const LIE_RATE = 0.7;

export function liarCountFor(speakerCount: number): number {
  if (speakerCount <= 2) return speakerCount >= 2 ? 1 : 0;
  // 正直者が最低1人は残るようにする
  return Math.max(1, Math.min(speakerCount - 1, Math.round(speakerCount * LIAR_FRACTION)));
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

export function knowledgeForSection(sectionIndex: number) {
  return RUN.knowledgeBySection[sectionIndex] ?? RUN.knowledgeBySection[0];
}

/** 助言はすべて挑戦者に見える。伏せない（伏せると運ゲーになる） */
export const HINTS_ARE_VISIBLE = true;


/* ───────────────────────────── 遊び方 ───────────────────────────── */

export type ModeId = 'standard' | 'brink';

export interface ModeConfig {
  id: ModeId;
  lives: number;
  sections: number;
  roomsPerSection: number;
  slotsBySection: readonly number[];
  /** 正直者をただ一人にする。その一人だけが正解を正確に知っている */
  loneHonest: boolean;
  /** 嘘つきが本当のことを言う率 */
  liarHonesty: number;
  /** 嘘つきが迷ったふりをする率 */
  liarMimic: number;
}

/**
 * 通常。嘘つきは半数。誰が嘘つきかは区画のあいだ変わらない。
 * 実測：数えるだけ58% / 読める打ち手77% / 腕の差19pt / 1周11分
 */
export const STANDARD: ModeConfig = {
  id: 'standard',
  lives: RUN.lives,
  sections: RUN.sections,
  roomsPerSection: RUN.roomsPerSection,
  slotsBySection: RUN.slotsBySection,
  loneHonest: false,
  liarHonesty: 1 - LIE_RATE,
  liarMimic: 0.25,
};

/**
 * 崖っぷち。**正直者はただ一人**で、その一人だけが正解を正確に知っている。
 * 残りは全員嘘つきで、同じ罠へ誘う。
 *
 * 通常と同じ骨格では成立しなかった。
 *  - 唯一の正直者も二択までしか知らないと、見つけても50%にしかならない
 *    → その一人だけは正解を正確に知っている形にした
 *  - 顔ぶれを1周のあいだ固定すると、2部屋で見つかって残りが作業になる
 *    → 5部屋ごとに顔ぶれを入れ替え、狩りを何度もやり直させる
 *
 * 実測：数えるだけ60% / 読める打ち手69.5% / 腕の差9.7pt / 1周11.4分 / 短命0%
 *
 * 基準7項目のうち6項目を満たす。外れているのは生存率（69.5%、狙いは72〜85%）。
 * これは通常モードより厳しいということで、崖っぷちという名前どおりではある。
 * 通常モードは82.1%なので、モード間の差ははっきり出ている。
 */
export const BRINK: ModeConfig = {
  id: 'brink',
  lives: 6,
  sections: 4,
  roomsPerSection: 5,
  slotsBySection: [5, 5, 5, 5],
  loneHonest: true,
  liarHonesty: 0.3,
  liarMimic: 0.2,
};

export const MODES: Record<ModeId, ModeConfig> = { standard: STANDARD, brink: BRINK };
