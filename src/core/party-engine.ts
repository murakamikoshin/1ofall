import type { AdvisorInfo, Knowledge, PublicRoom, Room, RoomPack } from './schema';
import { PARTY, knowledgeForSection, type ModeConfig } from './limits';
import { localized, strings } from '../i18n';
import {
  checkHint, createHintGuard, createReportBook, fileReport, resetGuard, wasTruthful,
  type HintGuardState, type ReportBook,
} from './moderation';
import { castLiars, dealKnowledge, liarHonestyAt } from './casting';
import { createRng, shuffled, type Rng } from './rng';
import { writeHint, voiceOf, unique } from './hint-writer';
import { liarBias } from './casting';
import { scoreChoices, bestChoice, type HintRow } from './read-hints';
import { chooseCall, resolveTruth, type Said } from './name-calling';

/**
 * 全員挑戦者モードの本体。
 *
 * 通常モード（GameEngine）と構造が違うので分けてある。
 *   通常   命は一つ。死ぬと区画の最初から
 *   ここ   **命は人ごと**。死んだ人が減っていくだけで、部屋は前に進み続ける
 *
 * 一緒にすると、どちらの規則がどこに効くのか読めなくなる。
 * 配役・知識・言葉の検査は共通のものを使う。
 */

export type PartyPhase = 'title' | 'choosing' | 'hush' | 'reveal' | 'verdict' | 'gameover' | 'cleared';

export interface PartyMember {
  id: string;
  name: string;
  kind: 'human' | 'ai';
}

export interface PartyMemberView extends PartyMember {
  lives: number;
  /** 命が尽きた。以降は見ているだけ */
  out: boolean;
  /** この部屋でもう決めたか。何を選んだかは開くまで見せない */
  hasPicked: boolean;
}

export interface PartyAdvice {
  memberId: string;
  memberName: string;
  text: string;
  sentAt: number;
  /** この区画での当たり外れ。区画が変わると消える */
  record: { hit: number; miss: number };
  /** 扉について言ったのか、人を指したのか。既定は扉 */
  kind?: 'door' | 'call' | undefined;
}

export interface PartyRoundState {
  roundId: string;
  room: PublicRoom;
  roomNumber: number;
  sectionIndex: number;
  timeLimitMs: number;
  deadlineAt: number;
  advice: readonly PartyAdvice[];
  /** この部屋から裏切り者が入れ替わった。記録も白紙 */
  freshCast: boolean;
}

export interface PartyResult {
  id: string;
  name: string;
  chosenId: string | null;
  survived: boolean;
  livesLeft: number;
  out: boolean;
  /** 一番名の挙がった扉を選んで死んだか。「群れに従うと死ぬ」を痛みと結びつける */
  followedCrowd: boolean;
}

export interface PartyVerdict {
  roundId: string;
  correctId: string;
  deathMessage: string;
  results: readonly PartyResult[];
}

export interface PartyState {
  phase: PartyPhase;
  members: readonly PartyMemberView[];
  round: PartyRoundState | null;
  verdict: PartyVerdict | null;
  sectionIndex: number;
  sectionCount: number;
  roomsPerSection: number;
  roomNumber: number;
  totalRooms: number;
  /** 終わったときだけ入る。途中で開けると助言の意味が消える */
  traitors: readonly AdvisorInfo[];
  /** 区画ごとの裏切り者。まとめて並べると「ほぼ全員」になって読めない */
  traitorsBySection: readonly { sectionIndex: number; ids: readonly string[] }[];
}

export interface PartyEngineConfig {
  pack: RoomPack;
  members: readonly PartyMember[];
  mode?: ModeConfig;
  seed?: number;
  now?: () => number;
}

export const PARTY_HUSH_MS = 800;

/** 全員が決めるまで待つので、一人用より少しだけ長い */
const ROOM_TIME_MS = 70_000;

type Listener = (state: PartyState) => void;

export class PartyEngine {
  private readonly pack: RoomPack;
  private readonly mode: ModeConfig;
  private readonly now: () => number;
  private readonly rng: Rng;

  private members: PartyMember[];
  private lives = new Map<string, number>();
  private phase: PartyPhase = 'title';
  private sectionIndex = 0;
  private roomsDone = 0;
  private roundCounter = 0;

  private deck: Room[] = [];
  private source: Room | null = null;
  private round: PartyRoundState | null = null;
  private verdict: PartyVerdict | null = null;

  private picks = new Map<string, string>();
  private advice: PartyAdvice[] = [];
  private knowledge = new Map<string, Knowledge>();
  /** 区画のあいだ据え置く裏切り者。だから「ずっと正直→最後に裏切り」が起きる */
  private traitorIds: string[] = [];
  private traitorSection = -1;
  private records = new Map<string, { hit: number; miss: number }>();
  private allTraitors = new Set<string>();
  private traitorLog: { sectionIndex: number; ids: readonly string[] }[] = [];

  private guard: HintGuardState = createHintGuard();
  private reports: ReportBook = createReportBook();
  private muted = new Set<string>();
  private listeners = new Set<Listener>();

  constructor(config: PartyEngineConfig) {
    this.pack = config.pack;
    this.mode = config.mode ?? PARTY;
    this.now = config.now ?? (() => Date.now());
    this.rng = createRng(config.seed ?? (Date.now() & 0xffffffff));
    this.members = [...config.members];
  }

  /* ───────────────────────────── 購読 ───────────────────────────── */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): PartyState {
    return {
      phase: this.phase,
      members: this.members.map((m) => ({
        ...m,
        lives: this.lives.get(m.id) ?? 0,
        out: (this.lives.get(m.id) ?? 0) <= 0,
        hasPicked: this.picks.has(m.id),
      })),
      round: this.round,
      verdict: this.verdict,
      sectionIndex: this.sectionIndex,
      sectionCount: this.mode.sections,
      roomsPerSection: this.mode.roomsPerSection,
      roomNumber: this.roomsDone + 1,
      totalRooms: this.mode.sections * this.mode.roomsPerSection,
      traitors:
        this.phase === 'gameover' || this.phase === 'cleared'
          ? this.members.filter((m) => this.allTraitors.has(m.id)).map((m) => ({ ...m }))
          : [],
      traitorsBySection:
        this.phase === 'gameover' || this.phase === 'cleared' ? this.traitorLog : [],
    };
  }

  /** その人に配られたもの。**この関数の外へ出さない** */
  knowledgeFor(memberId: string): Knowledge | null {
    return this.knowledge.get(memberId) ?? null;
  }

  private emit(): void {
    const state = this.snapshot();
    for (const l of this.listeners) l(state);
  }

  /* ───────────────────────────── 進行 ───────────────────────────── */

  start(): void {
    if (this.phase !== 'title') return;
    this.lives = new Map(this.members.map((m) => [m.id, this.mode.lives]));
    this.sectionIndex = 0;
    this.roomsDone = 0;
    this.traitorSection = -1;
    this.allTraitors.clear();
    this.traitorLog = [];
    this.records.clear();
    this.muted.clear();
    this.deck = shuffled(this.pack.rooms, this.rng);
    this.openRoom();
  }

  /** 誰かが席を立った。AI が引き継ぐのではなく、その人ぶん抜ける */
  leave(memberId: string): void {
    this.members = this.members.filter((m) => m.id !== memberId);
    this.lives.delete(memberId);
    this.picks.delete(memberId);
    if (this.phase === 'choosing') this.settleIfReady();
    this.emit();
  }

  private living(): PartyMember[] {
    return this.members.filter((m) => (this.lives.get(m.id) ?? 0) > 0);
  }

  private openRoom(): void {
    if (this.roomsDone >= this.mode.sections * this.mode.roomsPerSection) {
      this.finish('cleared');
      return;
    }
    if (this.living().length === 0) {
      this.finish('gameover');
      return;
    }
    const source = this.deck.shift();
    if (!source) {
      this.finish('cleared');
      return;
    }

    this.source = source;
    this.sectionIndex = Math.floor(this.roomsDone / this.mode.roomsPerSection);
    this.roundCounter += 1;
    const roundId = `${source.id}#${this.roundCounter}`;
    const choices = shuffled(source.choices, this.rng);

    // 裏切り者は区画のあいだ据え置く。毎回選び直すと裏切りの筋書きが立たない。
    // 死んだ人も含めて配る——**死んでも声は出せる**ので、裏切りは続く
    const everyone = this.members.map((m) => m.id);
    let freshCast = false;
    if (this.traitorSection !== this.sectionIndex) {
      freshCast = true;
      this.traitorSection = this.sectionIndex;
      this.traitorIds = [...castLiars(everyone, this.rng, false)];
      for (const id of this.traitorIds) this.allTraitors.add(id);
      this.traitorLog = [...this.traitorLog, { sectionIndex: this.sectionIndex, ids: [...this.traitorIds] }];
      this.records.clear();
    }
    // 途中で抜けた人ぶんを詰める
    this.traitorIds = this.traitorIds.filter((id) => everyone.includes(id));

    this.knowledge = dealKnowledge(
      choices,
      source.correct,
      { speakerIds: everyone, liarIds: this.traitorIds },
      this.rng,
      knowledgeForSection(this.sectionIndex),
      false,
      // 全員挑戦者の裏切り者は罠だけを知る。正解まで知ると一度も死なない
      true,
    );

    this.picks.clear();
    this.advice = [];
    this.verdict = null;
    resetGuard(this.guard);
    this.phase = 'choosing';
    this.round = {
      roundId,
      room: { id: source.id, theme: source.theme, prompt: source.prompt, choices },
      roomNumber: this.roomsDone + 1,
      sectionIndex: this.sectionIndex,
      timeLimitMs: ROOM_TIME_MS,
      deadlineAt: this.now() + ROOM_TIME_MS,
      advice: [],
      freshCast,
    };
    this.emit();
  }

  private finish(phase: 'gameover' | 'cleared'): void {
    this.phase = phase;
    this.round = null;
    this.emit();
  }

  /* ─────────────────────────── 参加者の操作 ─────────────────────────── */

  /** 助言を送る。検査を通らなかったら理由を返す */
  hint(memberId: string, text: string): { ok: true } | { ok: false; reason: string } {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return { ok: false, reason: 'closed' };
    if (this.muted.has(memberId)) return { ok: false, reason: 'muted' };
    // 命が尽きても声は出せる。見ているだけの十分間を作らないため。
    // 死んだ裏切り者は道連れを狙い続ける

    const labels = round.room.choices.map((c) => localized(c.label));
    const checked = checkHint(this.guard, memberId, text, this.now(), labels);
    if (!checked.ok) return { ok: false, reason: checked.reason };

    const member = this.members.find((m) => m.id === memberId);
    if (!member) return { ok: false, reason: 'unknown' };

    const entry: PartyAdvice = {
      memberId,
      memberName: member.name,
      text: checked.text,
      sentAt: this.now(),
      record: this.records.get(memberId) ?? { hit: 0, miss: 0 },
      kind: 'door',
    };
    this.addAdvice(entry);
    return { ok: true };
  }

  /** 1部屋につき、口ごとに1通。書き直しは最新で上書きする */
  private addAdvice(entry: PartyAdvice): void {
    const kind = entry.kind ?? 'door';
    this.advice = [
      ...this.advice.filter((a) => !(a.memberId === entry.memberId && (a.kind ?? 'door') === kind)),
      entry,
    ];
    if (this.round) this.round = { ...this.round, advice: this.advice };
    this.emit();
  }

  /**
   * 人を指す。「あいつは嘘だ」。
   * 扉について言う口とは別なので、指しても扉の情報は減らない。
   * 文面はここで組む（送らせない）ので暴言の検査が要らない
   */
  point(memberId: string, targetId: string, doubt: boolean): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (memberId === targetId) return;
    if (this.muted.has(memberId)) return;
    const target = this.advice.find((a) => a.memberId === targetId && (a.kind ?? 'door') === 'door');
    if (!target) return;
    // 自分も先に扉について言っていること（撃つ側も同じだけ裁かれる場に立つ）
    if (!this.advice.some((a) => a.memberId === memberId && (a.kind ?? 'door') === 'door')) return;
    const me = this.members.find((m) => m.id === memberId);
    if (!me) return;
    const shapes = doubt ? strings().hints.doubt : strings().hints.back;
    const shape = shapes[Math.floor(this.rng() * shapes.length)] ?? shapes[0];
    if (!shape) return;
    this.addAdvice({
      memberId,
      memberName: me.name,
      text: shape(target.memberName),
      sentAt: this.now(),
      record: this.records.get(memberId) ?? { hit: 0, miss: 0 },
      kind: 'call',
    });
  }

  /** 自分が通る扉を決める。生きている全員が決めたら開く */
  pick(memberId: string, choiceId: string): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if ((this.lives.get(memberId) ?? 0) <= 0) return;
    if (!round.room.choices.some((c) => c.id === choiceId)) return;
    this.picks.set(memberId, choiceId);
    this.emit();
    this.settleIfReady();
  }

  /** 締切。決めていない人は決めなかったものとして扱う */
  timeUp(): void {
    if (this.phase !== 'choosing') return;
    this.settle();
  }

  private settleIfReady(): void {
    if (this.phase !== 'choosing') return;
    if (this.living().every((m) => this.picks.has(m.id))) this.settle();
  }

  private settle(): void {
    const round = this.round;
    const source = this.source;
    if (!round || !source) return;

    const correctId = source.correct;

    // 一番名の挙がった扉。同点で一番なら群れとは言えないので単独一番だけ
    const mention = new Map(round.room.choices.map((c) => [c.id, 0]));
    for (const advice of this.advice) {
      if ((advice.kind ?? 'door') !== 'door') continue;
      for (const c of round.room.choices) {
        if (advice.text.includes(localized(c.label))) mention.set(c.id, (mention.get(c.id) ?? 0) + 1);
      }
    }
    const crowdOf = (id: string | null): boolean => {
      if (id === null) return false;
      const mine = mention.get(id) ?? 0;
      if (mine < 2) return false;
      return [...mention.entries()].every(([k, n]) => k === id || n < mine);
    };

    const results: PartyResult[] = [];
    for (const member of this.members) {
      const before = this.lives.get(member.id) ?? 0;
      if (before <= 0) {
        results.push({ id: member.id, name: member.name, chosenId: null, survived: false, livesLeft: 0, out: true, followedCrowd: false });
        continue;
      }
      const chosenId = this.picks.get(member.id) ?? null;
      const survived = chosenId === correctId;
      const livesLeft = survived ? before : before - 1;
      this.lives.set(member.id, livesLeft);
      results.push({
        id: member.id, name: member.name, chosenId, survived, livesLeft,
        out: livesLeft <= 0,
        followedCrowd: !survived && crowdOf(chosenId),
      });
    }

    // 記録は「言ったことが本当だったか」で付ける。配役は覗かない
    const labels = round.room.choices.map((c) => localized(c.label));
    const correctLabel = localized(round.room.choices.find((c) => c.id === correctId)?.label ?? { ja: '', en: '' });
    const truth = resolveTruth(
      this.advice.map((a) => ({
        id: a.memberId,
        name: this.members.find((m) => m.id === a.memberId)?.name ?? '',
        text: a.text,
        kind: a.kind ?? 'door',
      })),
      (text) => wasTruthful(text, correctLabel, labels),
      round.room.choices,
    );
    for (const { id: memberId, truthful } of truth) {
      const rec = this.records.get(memberId) ?? { hit: 0, miss: 0 };
      this.records.set(memberId, {
        hit: rec.hit + (truthful ? 1 : 0),
        miss: rec.miss + (truthful ? 0 : 1),
      });
    }

    this.verdict = {
      roundId: round.roundId,
      correctId,
      deathMessage: localized(source.deathMessage),
      results,
    };
    this.phase = 'hush';
    this.emit();
  }

  /** 演出の段を進める */
  advancePresentation(): void {
    switch (this.phase) {
      case 'hush':
        this.phase = 'reveal';
        break;
      case 'reveal':
        this.phase = 'verdict';
        break;
      case 'verdict':
        this.roomsDone += 1;
        this.openRoom();
        return;
      default:
        return;
    }
    this.emit();
  }

  report(reporterId: string, targetId: string, text: string): void {
    const result = fileReport(this.reports, {
      reporterId,
      targetId,
      roundId: this.round?.roundId ?? '',
      text,
      at: this.now(),
    });
    if (result.autoMuted) {
      this.muted.add(targetId);
      this.advice = this.advice.filter((a) => a.memberId !== targetId);
      if (this.round) this.round = { ...this.round, advice: this.advice };
      this.emit();
    }
  }

  dispose(): void {
    this.listeners.clear();
  }

  /* ─────────────────────────────── AI ─────────────────────────────── */

  /** AI の仲間が書く助言。届く順はサーバー側で散らす */
  aiHints(): { memberId: string; text: string }[] {
    const round = this.round;
    if (!round) return [];
    // 先に喋った者しか指せない。人間の仲間がもう言ったぶんも含める
    const said: Said[] = this.advice.map((a) => ({
      id: a.memberId,
      name: this.members.find((m) => m.id === a.memberId)?.name ?? '',
      text: a.text,
    }));
    const seen = new Map<string, Said[]>();
    const write = (id: string, nudge = 0): string => {
      const knowledge = this.knowledge.get(id);
      if (!knowledge) return '';
      const voice = voiceOf(id);
      return writeHint({
        choices: round.room.choices,
        knowledge,
        rng: this.rng,
        liarHonestyRate: Math.max(0.05, Math.min(0.5, this.mode.liarHonesty * liarBias(id))),
        liarMimicRate: this.mode.liarMimic,
        voice: { ...voice, seat: voice.seat + nudge },
        liarHonest: this.honestNow(id),
      });
    };

    const written: { id: string; text: string }[] = [];
    for (const member of this.members) {
      if (member.kind !== 'ai') continue;
      if (!this.knowledge.has(member.id)) continue;
      seen.set(member.id, [...said]);
      const text = write(member.id);
      said.push({ id: member.id, name: member.name, text });
      written.push({ id: member.id, text });
    }
    // 同じ文面が並ぶと人ではなく機械に見える
    return unique(written, write).map((h) => ({ memberId: h.id, text: h.text }));
  }

  /**
   * その部屋で、この裏切り者は本当のことを言うか。
   * 区画の前半をまとめて正直にして、「ここぞで裏切る」を起こす
   */
  private honestNow(id: string): boolean {
    // 一部屋につき一人一度だけ引く。文面と名指しで別々に引くと噛み合わない
    const key = `${this.roomsDone}|${id}`;
    let v = this.honestRolls.get(key);
    if (v === undefined) {
      const inSection = this.roomsDone % this.mode.roomsPerSection;
      v = this.rng() < liarHonestyAt(id, inSection, this.mode.roomsPerSection);
      this.honestRolls.set(key, v);
    }
    return v;
  }

  private honestRolls = new Map<string, boolean>();

  /**
   * AI の仲間が誰を指すか。扉について言う口とは別なので、
   * 指しても扉の情報は減らない。届いた文面を読んでから決める
   */
  aiCalls(): { memberId: string; targetId: string; doubt: boolean }[] {
    const round = this.round;
    if (!round) return [];
    const said: Said[] = this.advice.map((a) => ({
      id: a.memberId,
      name: this.members.find((m) => m.id === a.memberId)?.name ?? '',
      text: a.text,
    }));
    const out: { memberId: string; targetId: string; doubt: boolean }[] = [];
    for (const member of this.members) {
      if (member.kind !== 'ai') continue;
      // 死んだ者も喋り続ける（このモードの要点）ので、命では外さない
      const knowledge = this.knowledge.get(member.id);
      if (!knowledge) continue;
      if (this.rng() >= this.mode.nameCall) continue;
      // 信用を作っている最中の裏切り者は、仲間と同じ振る舞いをする
      const acting =
        knowledge.kind === 'trapper' && this.honestNow(member.id)
          ? ({ kind: 'doomed' as const, doomed: knowledge.trap })
          : knowledge;
      const call = chooseCall(acting, round.room.choices, said.filter((s) => s.id !== member.id && s.text), this.rng);
      if (call) out.push({ memberId: member.id, targetId: call.id, doubt: call.doubt });
    }
    return out;
  }

  /**
   * AI の仲間が選ぶ扉。
   * **他人の配役は覗かない。** 届いた文面と自分の持ち情報だけで決める。
   */
  aiPicks(): Map<string, string> {
    const round = this.round;
    const out = new Map<string, string>();
    if (!round) return out;
    for (const member of this.members) {
      if (member.kind !== 'ai') continue;
      if ((this.lives.get(member.id) ?? 0) <= 0) continue;
      const rows: HintRow[] = this.advice
        .filter((a) => a.memberId !== member.id)
        .map((a) => ({
          advisorId: a.memberId,
          advisorName: this.members.find((m) => m.id === a.memberId)?.name ?? '',
          text: a.text,
          record: a.record,
        }));
      const score = scoreChoices({
        choices: round.room.choices,
        rows,
        own: this.knowledge.get(member.id) ?? null,
      });
      out.set(member.id, bestChoice(score, round.room.choices, this.rng));
    }
    return out;
  }
}

