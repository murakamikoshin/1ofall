import { z } from 'zod';
import { ADVISOR_NAME_MAX, HINT_MAX_LENGTH, ROOM_CODE_LENGTH, SLOTS_MAX, SLOTS_MIN } from './limits';

/**
 * 部屋データと通信メッセージの唯一の正。
 * ここを起点に型を導出する（型とバリデータを二重管理しない）。
 */

/* ────────────────────────────── 部屋データ ────────────────────────────── */

export const ChoiceSchema = z.object({
  id: z.string().min(1),
  /** 画像パス。未配置なら描画側がプレースホルダにフォールバックする */
  image: z.string().optional(),
  label: z.string().min(1).max(24),
});

const RoomBaseSchema = z.object({
    id: z.string().min(1),
    theme: z.string().min(1),
    prompt: z.string().min(1).max(40),
    /** 勘で当たらないよう原則5択以上。3〜8で受け付ける */
    choices: z.array(ChoiceSchema).min(3).max(8),
    correct: z.string().min(1),
  deathMessage: z.string().min(1).max(40),
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

export { HINT_MAX_LENGTH } from './limits';

/* ───────────────────────── クライアント→サーバー ───────────────────────── */

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('advisor/join'), name: AdvisorNameSchema.optional(), roomCode: z.string().length(ROOM_CODE_LENGTH) }),
  z.object({ t: z.literal('advisor/hint'), text: z.string().max(HINT_MAX_LENGTH), roundId: z.string() }),
  z.object({ t: z.literal('advisor/volunteer'), roundId: z.string() }),
  z.object({ t: z.literal('challenger/start') }),
  z.object({ t: z.literal('challenger/choose'), choiceId: z.string(), roundId: z.string() }),
  z.object({ t: z.literal('challenger/silence'), advisorId: AdvisorIdSchema, roundId: z.string() }),
  z.object({ t: z.literal('challenger/setSpeakerSlots'), slots: z.number().int().min(SLOTS_MIN).max(SLOTS_MAX) }),
  z.object({ t: z.literal('challenger/setSelectionMode'), mode: z.enum(['lottery', 'nominate']) }),
  z.object({ t: z.literal('challenger/kick'), advisorId: AdvisorIdSchema }),
]);

/* ───────────────────────── サーバー→クライアント ───────────────────────── */

export const RoleSchema = z.object({
  isSpeaker: z.boolean(),
  isLiar: z.boolean(),
});

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('room/state'), phase: z.string(), lives: z.number().int(), roomNumber: z.number().int() }),
  z.object({
    t: z.literal('round/open'),
    roundId: z.string(),
    room: PublicRoomSchema,
    /** 助言者にだけ送る。挑戦者クライアントには絶対に送らない */
    correct: z.string().optional(),
    role: RoleSchema.optional(),
    deadlineAt: z.number().int(),
  }),
  z.object({ t: z.literal('round/hints'), roundId: z.string(), hints: z.array(HintSchema) }),
  z.object({ t: z.literal('round/result'), roundId: z.string(), chosen: z.string(), correct: z.string(), survived: z.boolean() }),
  z.object({ t: z.literal('game/over'), cleared: z.boolean(), liars: z.array(AdvisorInfoSchema) }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
