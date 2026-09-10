import { z } from 'zod';
import { LOCALES } from '../i18n/locales';
import { ADVISOR_NAME_MAX, HINT_MAX_LENGTH, MODE_IDS, ROOM_CODE_LENGTH, SLOTS_MAX } from './limits';

/**
 * 部屋データと通信メッセージの唯一の正。
 * ここを起点に型を導出する（型とバリデータを二重管理しない）。
 */

/* ────────────────────────────── 部屋データ ────────────────────────────── */

/** 言語ごとに用意する文字列。部屋データはすべてこの形で持つ */
const LocalizedText = (max: number) =>
  z.object(Object.fromEntries(LOCALES.map((l) => [l, z.string().min(1).max(max)])) as Record<
    (typeof LOCALES)[number],
    z.ZodString
  >);

export const LocalizedLabelSchema = LocalizedText(28);
export const LocalizedLineSchema = LocalizedText(48);

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  /** 画像パス。未配置なら描画側がプレースホルダにフォールバックする */
  image: z.string().optional(),
  label: LocalizedLabelSchema,
});

const RoomBaseSchema = z.object({
    id: z.string().min(1),
    theme: z.string().min(1),
    prompt: LocalizedLineSchema,
    /** 勘で当たらないよう原則5択以上。3〜8で受け付ける */
    choices: z.array(ChoiceSchema).min(3).max(8),
    correct: z.string().min(1),
  deathMessage: LocalizedLineSchema,
});

export const RoomSchema = RoomBaseSchema.superRefine((room, ctx) => {
  const ids = room.choices.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${room.id}: choice.id が重複` });
  }
  if (!ids.includes(room.correct)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${room.id}: correct が choices に無い` });
  }
});

/**
 * 挑戦者に渡してよい部屋。正解と死亡文は含めない。
 * ネットワーク越しでも同じ型を使うので、答えが挑戦者側へ流れる経路が型で塞がれる。
 */
export const PublicRoomSchema = RoomBaseSchema.omit({ correct: true, deathMessage: true });

export const RoomPackSchema = z.object({
  /** 将来のプレイヤー投稿パックを見越して、部屋は必ずパック単位で扱う */
  packId: z.string().min(1),
  title: z.string().min(1),
  rooms: z.array(RoomSchema).min(1),
});

export type Choice = z.infer<typeof ChoiceSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type PublicRoom = z.infer<typeof PublicRoomSchema>;
export type RoomPack = z.infer<typeof RoomPackSchema>;

/* ─────────────────────────── 助言者まわりの値 ─────────────────────────── */

export const AdvisorIdSchema = z.string().min(1).max(64);
export const AdvisorNameSchema = z.string().min(1).max(ADVISOR_NAME_MAX);

export const AdvisorInfoSchema = z.object({
  id: AdvisorIdSchema,
  name: AdvisorNameSchema,
  /** 人間かAIか。ソロモードの AI 嘘つきを同じ経路に流すための識別 */
  kind: z.enum(['human', 'ai']),
});

export const HintSchema = z.object({
  advisorId: AdvisorIdSchema,
  advisorName: AdvisorNameSchema,
  text: z.string().trim().min(1).max(HINT_MAX_LENGTH),
  roundId: z.string().min(1),
  sentAt: z.number().int().nonnegative(),
  /**
   * 扉について言ったのか、人を指したのか。
   *
   * 一部屋につき、扉の話が一つと人を指すのが一つ。**別の口**にしてある。
   * 同じ口にすると人を指すたびに扉の情報が減り、実測で読める打ち手が
   * 5pt 落ちた（tools/rubric.mjs、指す率0.3）。別にすれば情報は減らず、
   * 崖っぷちでは読める打ち手が 72.0%→77.2% に上がる。
   */
  kind: z.enum(['door', 'call']).optional(),
});

export type AdvisorInfo = z.infer<typeof AdvisorInfoSchema>;
export type Hint = z.infer<typeof HintSchema>;

/**
 * 助言者ひとりに配られる知識。**正解が乗る唯一の型**。
 *
 * 説明は casting.ts 側に書いてある。ここに置いてあるのは、
 * ネットワーク越しに同じものを送るから。型と検証を二重管理しない。
 */
export const KnowledgeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('liar'), correct: z.string().min(1), trap: z.string().min(1) }),
  z.object({ kind: z.literal('honest'), candidates: z.array(z.string().min(1)).min(1).max(8) }),
  z.object({ kind: z.literal('doomed'), doomed: z.string().min(1) }),
  z.object({ kind: z.literal('trapper'), trap: z.string().min(1) }),
]);

export type Knowledge = z.infer<typeof KnowledgeSchema>;

export { HINT_MAX_LENGTH } from './limits';

export const ModeIdSchema = z.enum(MODE_IDS);
export const LocaleSchema = z.enum(LOCALES);

/* ───────────────────────── クライアント→サーバー ───────────────────────── */

/**
 * ここが**信用できない側**。ブラウザから何が来てもおかしくないので、
 * サーバーは必ずこのスキーマを通してから触る。
 * 文字数の上限もここで縛る（クライアント側の検査は素通りされうる）。
 */
export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('advisor/join'), name: AdvisorNameSchema.optional(), roomCode: z.string().length(ROOM_CODE_LENGTH) }),
  z.object({ t: z.literal('advisor/hint'), text: z.string().max(HINT_MAX_LENGTH), roundId: z.string() }),
  z.object({ t: z.literal('advisor/volunteer'), roundId: z.string() }),
  /**
   * 人を指す。「あいつは嘘だ」「あいつは本当だ」。
   *
   * **文面は送らせない。** 相手のIDと向きだけ受け取ってサーバーが書く。
   * こうすると暴言の検査を通す必要が無く、日本語を打てない人でも押せる。
   */
  z.object({
    t: z.literal('advisor/point'),
    roundId: z.string(),
    targetId: AdvisorIdSchema,
    doubt: z.boolean(),
  }),
  /** 発言枠の外の人が一票入れる。1000人の視聴者に渡す唯一の手 */
  z.object({ t: z.literal('advisor/vote'), roundId: z.string(), choiceId: z.string().min(1) }),
  /** 助言者どうしの通報。暴言を見た者がその場で挙げる */
  z.object({ t: z.literal('advisor/report'), targetId: AdvisorIdSchema, roundId: z.string(), text: z.string().max(HINT_MAX_LENGTH) }),
  /** 全員挑戦者モード。助言者席の人間も自分の扉を選ぶ */
  z.object({ t: z.literal('party/pick'), roundId: z.string(), choiceId: z.string().min(1) }),
  z.object({ t: z.literal('challenger/start'), mode: ModeIdSchema, locale: LocaleSchema.optional() }),
  z.object({ t: z.literal('challenger/choose'), choiceId: z.string(), roundId: z.string() }),
  z.object({ t: z.literal('challenger/silence'), advisorId: AdvisorIdSchema, roundId: z.string() }),
  z.object({ t: z.literal('challenger/report'), advisorId: AdvisorIdSchema, roundId: z.string(), text: z.string().max(HINT_MAX_LENGTH) }),
  z.object({ t: z.literal('challenger/setSelectionMode'), mode: z.enum(['lottery', 'nominate']) }),
  /** 指名方式のとき、次の区画で喋らせる面々 */
  z.object({ t: z.literal('challenger/nominate'), advisorIds: z.array(AdvisorIdSchema).max(SLOTS_MAX) }),
  /** 死亡演出の段を進める。「間」は本体が持つので合図だけ送る */
  z.object({ t: z.literal('challenger/advance') }),
]);

/* ───────────────────────── サーバー→クライアント ───────────────────────── */

/**
 * 挑戦者の画面がそのまま描ける形。
 *
 * **答えに触れるものを載せない。**
 *  - room は PublicRoom（正解と死亡文が落ちている）
 *  - liarLog は載せない。今の部屋の嘘つきが分かると助言の意味が消える
 *    （終わったあとの開示は game/over が別に運ぶ）
 * verdict は選んだあとにしか立たないので、そのまま載せてよい。
 */
export const AdviceSchema = z.object({
  advisorId: AdvisorIdSchema,
  advisorName: AdvisorNameSchema,
  text: z.string(),
  sentAt: z.number().int(),
  record: z.object({ hit: z.number().int(), miss: z.number().int() }),
  /** 扉について言ったのか、人を指したのか */
  kind: z.enum(['door', 'call']).optional(),
});

/**
 * 区画の答え合わせ。
 *
 * **遊んでいるあいだ、嘘つきは線に載せない。** 判定に `liars` を積んでいたので、
 * 部屋を一つ抜けるたびに区画ぶんの配役が挑戦者の線へ流れていた（画面には
 * 出していないが、開けば読める）。顔ぶれは区画のあいだ変わらないので、
 * 一部屋目の判定を覗くだけで、その区画の読み合いが全部終わっていた。
 * 開くのは区画を離れる瞬間だけにする。
 */
export const SectionAnswerSchema = z.object({
  sectionIndex: z.number().int(),
  cleared: z.boolean(),
  rows: z.array(
    z.object({
      id: AdvisorIdSchema,
      name: AdvisorNameSchema,
      liar: z.boolean(),
      hit: z.number().int().nonnegative(),
      miss: z.number().int().nonnegative(),
    }),
  ),
});

export const ChallengerViewSchema = z.object({
  phase: z.string(),
  mode: ModeIdSchema,
  lives: z.number().int(),
  maxLives: z.number().int(),
  sectionIndex: z.number().int(),
  sectionCount: z.number().int(),
  totalCleared: z.number().int(),
  totalRooms: z.number().int(),
  /**
   * いまの区画の部屋数。区画ごとに違う（奥だけ短い）ので、
   * 全体÷区画数では出せない
   */
  roomsPerSection: z.number().int(),
  advisors: z.array(AdvisorInfoSchema),
  mutedIds: z.array(AdvisorIdSchema),
  /** 黙らせて当たった相手。挑戦者が自分で得た情報なので送ってよい */
  confirmedLiars: z.array(AdvisorIdSchema),
  canSilence: z.boolean(),
  round: z
    .object({
      roundId: z.string(),
      room: PublicRoomSchema,
      roomNumber: z.number().int(),
      sectionIndex: z.number().int(),
      timeLimitMs: z.number().int(),
      deadlineAt: z.number().int(),
      speakers: z.array(AdvisorInfoSchema),
      advice: z.array(AdviceSchema),
      silenceUsed: z.boolean(),
      freshCast: z.boolean(),
      /** 枠外の票。挑戦者に見えるが当てにならない */
      crowd: z.array(z.object({ choiceId: z.string(), votes: z.number().int().nonnegative() })),
      ownCandidates: z.array(z.string()),
      restingIds: z.array(AdvisorIdSchema),
    })
    .nullable(),
  verdict: z
    .object({
      roundId: z.string(),
      chosenId: z.string().nullable(),
      correctId: z.string(),
      survived: z.boolean(),
      timedOut: z.boolean(),
      deathMessage: z.string(),
      livesLeft: z.number().int(),
      fatal: z.boolean(),
      followedCrowd: z.boolean(),
      party: z.array(
        z.object({ id: AdvisorIdSchema, name: AdvisorNameSchema, chosenId: z.string(), survived: z.boolean() }),
      ),
    })
    .nullable(),
  /** 区画を離れるときの答え合わせ。離れる瞬間だけ載る */
  sectionAnswer: SectionAnswerSchema.nullable(),
  serverNow: z.number().int(),
});

export type ChallengerView = z.infer<typeof ChallengerViewSchema>;

/**
 * 全員挑戦者モードの画面ぶん。**一人ずつ宛てて送る**（自分の知識が乗るため）。
 * 命が人ごとにあるので、通常モードの room/view とは別の形。
 */
export const PartyViewSchema = z.object({
  phase: z.string(),
  meId: AdvisorIdSchema,
  members: z.array(
    z.object({
      id: AdvisorIdSchema,
      name: AdvisorNameSchema,
      kind: z.enum(['human', 'ai']),
      lives: z.number().int(),
      out: z.boolean(),
      hasPicked: z.boolean(),
    }),
  ),
  round: z
    .object({
      roundId: z.string(),
      room: PublicRoomSchema,
      roomNumber: z.number().int(),
      sectionIndex: z.number().int(),
      timeLimitMs: z.number().int(),
      deadlineAt: z.number().int(),
      advice: z.array(
        z.object({
          memberId: AdvisorIdSchema,
          memberName: AdvisorNameSchema,
          text: z.string(),
          sentAt: z.number().int(),
          record: z.object({ hit: z.number().int(), miss: z.number().int() }),
          kind: z.enum(['door', 'call']).optional(),
        }),
      ),
      freshCast: z.boolean(),
    })
    .nullable(),
  verdict: z
    .object({
      roundId: z.string(),
      correctId: z.string(),
      deathMessage: z.string(),
      results: z.array(
        z.object({
          id: AdvisorIdSchema,
          name: AdvisorNameSchema,
          chosenId: z.string().nullable(),
          survived: z.boolean(),
          livesLeft: z.number().int(),
          out: z.boolean(),
          followedCrowd: z.boolean(),
        }),
      ),
    })
    .nullable(),
  sectionIndex: z.number().int(),
  sectionCount: z.number().int(),
  roomsPerSection: z.number().int(),
  roomNumber: z.number().int(),
  totalRooms: z.number().int(),
  traitors: z.array(AdvisorInfoSchema),
  traitorsBySection: z.array(z.object({ sectionIndex: z.number().int(), ids: z.array(AdvisorIdSchema) })),
  /**
   * 区画の答え合わせ。離れる瞬間だけ載る。
   * 全員の合図は待てないので、いつまで出すかを時刻で運ぶ
   */
  sectionAnswer: SectionAnswerSchema.extend({ untilMs: z.number().int() })
    .omit({ cleared: true })
    .nullable(),
  /** その人自身に配られたもの。ほかの人には送らない */
  knowledge: KnowledgeSchema.nullable(),
  serverNow: z.number().int(),
});

export type PartyView = z.infer<typeof PartyViewSchema>;

export const ServerMessageSchema = z.discriminatedUnion('t', [
  /** 全員挑戦者モードの画面ぶん。宛先ごとに中身が違う */
  z.object({ t: z.literal('party/view'), view: PartyViewSchema }),
  /** 挑戦者の画面ぶんまるごと。助言者には送らない */
  z.object({ t: z.literal('room/view'), view: ChallengerViewSchema }),
  z.object({
    t: z.literal('room/state'),
    phase: z.string(),
    mode: ModeIdSchema,
    lives: z.number().int(),
    roomNumber: z.number().int(),
    sectionIndex: z.number().int().nonnegative(),
    sectionCount: z.number().int().positive(),
    roster: z.array(AdvisorInfoSchema),
  }),
  z.object({
    t: z.literal('round/open'),
    roundId: z.string(),
    room: PublicRoomSchema,
    deadlineAt: z.number().int(),
    /** 送った時点のサーバー時刻。端末の時計がずれていても残り時間が合う */
    serverNow: z.number().int(),
    /**
     * **助言者ひとりひとりに宛てて送る**。挑戦者クライアントには絶対に乗せない。
     * 目利き（候補2〜3）・耳打ち（死ぬ方だけ）・裏切り者（罠だけ）を
     * 一つの型で表せるようにしてある。以前は正解1つしか運べなかった
     */
    knowledge: KnowledgeSchema.optional(),
    isSpeaker: z.boolean().optional(),
    /**
     * 区画の何部屋目か（0始まり）。
     * 手を挙げた扱いが区画のあいだ続くので、いつ切れるかを画面が知るために要る
     */
    roomInSection: z.number().int().nonnegative().optional(),
    /**
     * 受け取る本人のID。
     * 場に並ぶ言葉のどれが自分のものかを見分けるために要る
     * （自分を撃つ手を出してしまわないように）。
     */
    you: AdvisorIdSchema.optional(),
    /** 自分が枠外の票をどこへ入れたか（画面に残すため） */
    myVote: z.string().optional(),
    /** 全員挑戦者モードで、その人自身に配られた候補 */
    ownCandidates: z.array(z.string().min(1)).optional(),
    /** この部屋を休んでいる者。発言枠の抽選から外れる */
    restingIds: z.array(AdvisorIdSchema).optional(),
  }),
  z.object({ t: z.literal('round/hints'), roundId: z.string(), hints: z.array(HintSchema) }),
  z.object({
    t: z.literal('round/result'),
    roundId: z.string(),
    chosen: z.string(),
    correct: z.string(),
    survived: z.boolean(),
    /** 全員挑戦者モード。誰がどれを選んだか */
    picks: z.array(z.object({ advisorId: AdvisorIdSchema, choiceId: z.string() })).optional(),
  }),
  /**
   * 区画の答え合わせ。**助言者にも配る。**
   *
   * 助言者は自分の役しか知らない。嘘をついた側は「刺さったのか」を、
   * 正直に言った側は「なぜ信じられなかったのか」を、
   * ここまで一度も知らないまま部屋を出ていた。
   * 顔ぶれは区画をまたいで残らないので、離れる瞬間に開いても先へは漏れない。
   */
  z.object({
    t: z.literal('section/answer'),
    sectionIndex: z.number().int(),
    cleared: z.boolean(),
    rows: z.array(
      z.object({
        id: AdvisorIdSchema,
        name: AdvisorNameSchema,
        liar: z.boolean(),
        hit: z.number().int().nonnegative(),
        miss: z.number().int().nonnegative(),
      }),
    ),
  }),
  /**
   * 枠外から一票入れた本人にだけ、当たり外れと通算を返す。
   *
   * 配信で1000人いても発言できるのは8人。残りに渡せるのは自分の賭けだけ。
   * 盤面を動かさないので情報の汚染にはならないが、
   * 毎部屋「自分は当てられたか」が残る。
   */
  z.object({
    t: z.literal('advisor/voteResult'),
    roundId: z.string(),
    hit: z.boolean(),
    correct: z.string(),
    record: z.object({ hit: z.number().int(), miss: z.number().int() }),
  /**
   * 賭けている人の中での順位。
   *
   * 配信で1000人が見ていると、発言できるのは8人。残りに渡せる手は
   * 一票だけで、当たり外れの通算しか返していなかった。
   * 「4/1」だけ見ても自分が上手いのか下手なのか分からない。
   * 順位は、当てているほど発言枠へ上がりやすい仕組み（slotWeight）と
   * 地続きなので、上がる道が見える形になる。
   */
    rank: z.object({ place: z.number().int().positive(), of: z.number().int().positive() }).optional(),
  }),
  /** 黙らされた本人にだけ送る。以降その部屋の助言は届かない */
  z.object({ t: z.literal('advisor/silenced'), roundId: z.string() }),
  /** 通報が積もって自動的に黙らされた。本人には理由を伝えない */
  z.object({ t: z.literal('advisor/muted') }),
  /**
   * 一周の終わり。**ここで初めて嘘つきを開く。**
   *
   * 区画ごとに分けて運ぶ。まとめて一行に並べると、4区画ぶんで
   * ほぼ全員の名前が並んで読めなくなる（知りたいのは
   * 「最後に自分が読んでいた卓は誰が嘘をついていたか」）。
   */
  z.object({
    t: z.literal('game/over'),
    cleared: z.boolean(),
    liars: z.array(AdvisorInfoSchema),
    liarsBySection: z
      .array(z.object({ sectionIndex: z.number().int(), ids: z.array(AdvisorIdSchema) }))
      .optional(),
  }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/* ─────────────────────────── 待合室（野良） ─────────────────────────── */

/**
 * 知らない人同士を突き合わせる待合。部屋そのものとは別の場所に立てる。
 * ここでやるのは「合言葉を配ること」だけで、ゲームは知らない。
 */
export const LobbyClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('lobby/wait'), mode: ModeIdSchema, name: AdvisorNameSchema.optional() }),
  z.object({ t: z.literal('lobby/cancel') }),
]);

export const LobbyServerMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('lobby/waiting'),
    waiting: z.number().int().nonnegative(),
    need: z.number().int().positive(),
    /** これを過ぎたら人数が足りなくても始める */
    startsBy: z.number().int(),
    serverNow: z.number().int(),
  }),
  z.object({
    t: z.literal('lobby/found'),
    roomCode: z.string().length(ROOM_CODE_LENGTH),
    /** この人が部屋を開ける。ほかは入るだけ */
    host: z.boolean(),
  }),
]);

export type LobbyClientMessage = z.infer<typeof LobbyClientMessageSchema>;
export type LobbyServerMessage = z.infer<typeof LobbyServerMessageSchema>;
