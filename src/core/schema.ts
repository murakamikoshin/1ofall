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

export const ServerMessageSchema = z.discriminatedUnion('t', [
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
  /** 黙らされた本人にだけ送る。以降その部屋の助言は届かない */
  z.object({ t: z.literal('advisor/silenced'), roundId: z.string() }),
  /** 通報が積もって自動的に黙らされた。本人には理由を伝えない */
  z.object({ t: z.literal('advisor/muted') }),
  z.object({ t: z.literal('game/over'), cleared: z.boolean(), liars: z.array(AdvisorInfoSchema) }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
