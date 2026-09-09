import type { AdvisorInfo, Hint, PublicRoom, Room, RoomPack } from './schema';
import { RUN, knowledgeForSection, STANDARD, type ModeConfig } from './limits';
import { localized } from '../i18n';
import {
  checkHint, createHintGuard, createReportBook, fileReport, reportCount, resetGuard, wasTruthful,
  type HintGuardState, type ReportBook,
} from './moderation';
import {
  castLiars, castSpeakers, clampSlots, dealKnowledge, dealOwnKnowledge,
  type Casting, type SelectionMode,
} from './casting';
import { createRng, shuffled, pickSome, type Rng } from './rng';
import type { AdvisorGateway, Unsubscribe } from './advisor-gateway';
import { NullAdvisorGateway } from './advisor-gateway';

/**
 * ゲーム本体のロジック。DOM も通信も知らない純粋な状態機械。
 * 配信 / 友達内 / ソロで同じインスタンスが動く。差は AdvisorGateway だけ。
 */

export type Phase =
  | 'title'
  /** 部屋が出た。助言は伏せて届く。挑戦者は開く相手を選び、1つ選ぶ */
  | 'choosing'
  /** 選択直後の無音。0.8秒。すべての音と動きを止める */
  | 'hush'
  /** 選んだ選択肢にライトが寄る */
  | 'reveal'
  /** 生死の確定 */
  | 'verdict'
  | 'gameover'
  | 'cleared';

/** 届いた助言。中身は最初から見えている（伏せると運ゲーになる） */
export interface Advice {
  advisorId: string;
  advisorName: string;
  text: string;
  sentAt: number;
  /** この区画で、この人の助言に従っていたらどうだったか。区画が変わると消える */
  record: { hit: number; miss: number };
}

export interface RoundState {
  roundId: string;
  /** 選択肢は毎回並びが変わる。正解と死亡文は含まない */
  room: PublicRoom;
  index: number;
  roomNumber: number;
  sectionIndex: number;
  timeLimitMs: number;
  deadlineAt: number;
  /** この区画の発言枠。区画のあいだ顔ぶれは変わらない */
  speakers: readonly AdvisorInfo[];
  /** 届いた助言。すべて見える */
  advice: readonly Advice[];
  silenceUsed: boolean;
  /**
   * 全員挑戦者モードで、挑戦者自身に配られた部分情報。
   * 「このどれかが生きる」。全員を疑っても手詰まりにならないための足場。
   */
  ownCandidates: readonly string[];
  /** 死んで今回休んでいる仲間 */
  restingIds: readonly string[];
}

export interface Verdict {
  roundId: string;
  chosenId: string | null;
  correctId: string;
  survived: boolean;
  timedOut: boolean;
  deathMessage: string;
  livesLeft: number;
  fatal: boolean;
  /** この部屋で嘘をついていた面々（開封の有無にかかわらず開示する） */
  liars: readonly AdvisorInfo[];
  /**
   * 全員挑戦者モードで、仲間がそれぞれ何を選んだか。
   * 言ったことと選んだことのずれが、ここで見える。
   */
  party: readonly { id: string; name: string; chosenId: string; survived: boolean }[];
}

export interface EngineConfig {
  pack: RoomPack;
  mode?: ModeConfig;
  lives?: number;
  sections?: number;
  roomsPerSection?: number;
  baseTimeMs?: number;
  penaltyTimeMs?: number;
  seed?: number;
  gateway?: AdvisorGateway;
  now?: () => number;
}

export interface EngineState {
  phase: Phase;
  lives: number;
  maxLives: number;
  round: RoundState | null;
  verdict: Verdict | null;
  sectionIndex: number;
  sectionCount: number;
  /** 区画内で抜けた部屋数 */
  clearedInSection: number;
  roomsPerSection: number;
  totalCleared: number;
  totalRooms: number;
  selectionMode: SelectionMode;
  advisors: readonly AdvisorInfo[];
  mutedIds: readonly string[];
  liarLog: readonly { roundId: string; liarIds: readonly string[] }[];
}

export const HUSH_MS = 800;

type Listener = (state: EngineState) => void;

export class GameEngine {
  private readonly pack: RoomPack;
  private readonly gateway: AdvisorGateway;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly cfg: Required<
    Pick<EngineConfig, 'lives' | 'sections' | 'roomsPerSection' | 'baseTimeMs' | 'penaltyTimeMs'>
  >;
  private readonly mode: ModeConfig;

  private phase: Phase = 'title';
  private lives: number;
  private sectionIndex = 0;
  private clearedInSection = 0;
  private totalCleared = 0;
  private round: RoundState | null = null;
  private verdict: Verdict | null = null;
  private selectionMode: SelectionMode = 'lottery';
  private muted = new Set<string>();
  private nextRoundPenaltyMs = 0;
  private advisors: readonly AdvisorInfo[] = [];
  private liarLog: { roundId: string; liarIds: readonly string[] }[] = [];
  private nominated: string[] = [];
  private roundCounter = 0;

  /** この周でまだ出していない部屋。同じ部屋を続けて見せないための山札 */
  private deck: Room[] = [];
  private currentSource: Room | null = null;
  private currentCasting: Casting = { speakerIds: [], liarIds: [] };
  /** 区画のあいだの当たり外れ。配役が固定なので手掛かりになる */
  private records = new Map<string, { hit: number; miss: number }>();
  /** 全員挑戦者モードで、死んで次の部屋を休む仲間 */
  private resting = new Set<string>();
  private ownCandidates: readonly string[] = [];
  /** 区画のあいだ据え置く配役 */
  private sectionCasting: Casting | null = null;
  private sectionCastingIndex = -1;
  /** 文字数・連投・NGワードの検査。段階4のサーバーも同じものを通す */
  private guard: HintGuardState = createHintGuard();
  /** 通報。一定数集まったらその人の助言は届かなくなる */
  private reports: ReportBook = createReportBook();

  private listeners = new Set<Listener>();
  private unsubs: Unsubscribe[] = [];

  constructor(config: EngineConfig) {
    this.pack = config.pack;
    this.gateway = config.gateway ?? new NullAdvisorGateway();
    this.now = config.now ?? (() => Date.now());
    this.rng = createRng(config.seed ?? (Date.now() & 0xffffffff));
    this.mode = config.mode ?? STANDARD;
    this.cfg = {
      lives: config.lives ?? this.mode.lives,
      sections: config.sections ?? this.mode.sections,
      roomsPerSection: config.roomsPerSection ?? this.mode.roomsPerSection,
      baseTimeMs: config.baseTimeMs ?? RUN.baseTimeMs,
      penaltyTimeMs: config.penaltyTimeMs ?? RUN.penaltyTimeMs,
    };
    this.lives = this.cfg.lives;

    this.advisors = this.gateway.roster();
    this.unsubs.push(
      this.gateway.onHint((hint) => this.receiveHint(hint)),
      this.gateway.onRosterChange((roster) => {
        this.advisors = roster;
        this.emit();
      }),
    );
  }

  /* ───────────────────────────── 購読 ───────────────────────────── */

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  modeId(): ModeConfig['id'] {
    return this.mode.id;
  }

  snapshot(): EngineState {
    return {
      phase: this.phase,
      lives: this.lives,
      maxLives: this.cfg.lives,
      round: this.round,
      verdict: this.verdict,
      sectionIndex: this.sectionIndex,
      sectionCount: this.cfg.sections,
      clearedInSection: this.clearedInSection,
      roomsPerSection: this.cfg.roomsPerSection,
      totalCleared: this.totalCleared,
      totalRooms: this.cfg.sections * this.cfg.roomsPerSection,
      selectionMode: this.selectionMode,
      advisors: this.advisors,
      mutedIds: [...this.muted],
      liarLog: this.liarLog,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const l of this.listeners) l(state);
  }

  /* ───────────────────────── 挑戦者からの操作 ───────────────────────── */

  start(): void {
    if (this.phase !== 'title') return;
    this.lives = this.cfg.lives;
    this.sectionIndex = 0;
    this.clearedInSection = 0;
    this.totalCleared = 0;
    this.muted.clear();
    this.records.clear();
    this.resting.clear();
    this.sectionCasting = null;
    this.liarLog = [];
    this.nextRoundPenaltyMs = 0;
    this.deck = shuffled(this.pack.rooms, this.rng);
    this.openRoom();
  }

  setSelectionMode(mode: SelectionMode): void {
    this.selectionMode = mode;
    this.emit();
  }

  nominate(advisorIds: readonly string[]): void {
    this.nominated = advisorIds.slice(0, RUN.slotsBySection[0] ?? 8);
    this.emit();
  }

  /** 発言者を1人黙らせる。当たれば以降その人の助言は届かない。外したら次の部屋が短くなる */
  silence(advisorId: string): { hit: boolean } | null {
    const round = this.round;
    if (!round || this.phase !== 'choosing' || round.silenceUsed) return null;
    if (!round.speakers.some((s) => s.id === advisorId)) return null;

    round.silenceUsed = true;
    const hit = this.currentCasting.liarIds.includes(advisorId);
    if (hit) {
      this.muted.add(advisorId);
      round.advice = round.advice.filter((a) => a.advisorId !== advisorId);
    } else {
      this.nextRoundPenaltyMs += this.cfg.penaltyTimeMs;
    }
    this.emit();
    return { hit };
  }

  /**
   * 助言者を通報する。一定数集まると以降その人の助言は届かない。
   * 挑戦者の「黙らせる」と違い、当てる／外すの読み合いではなく、
   * 迷惑行為を止めるための仕組み。
   */
  report(reporterId: string, targetId: string, text: string): { accepted: boolean; count: number } {
    const round = this.round;
    const result = fileReport(this.reports, {
      reporterId,
      targetId,
      roundId: round?.roundId ?? '',
      text,
      at: this.now(),
    });
    if (result.autoMuted) {
      this.muted.add(targetId);
      if (round) round.advice = round.advice.filter((a) => a.advisorId !== targetId);
      this.sectionCasting = null; // 顔ぶれを引き直す
      this.emit();
    }
    return { accepted: result.accepted, count: result.count };
  }

  reportsAgainst(advisorId: string): number {
    return reportCount(this.reports, advisorId);
  }

  choose(choiceId: string): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    this.settle(round, choiceId, false);
  }

  timeUp(): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    this.settle(round, null, true);
  }

  /** 死亡演出の各段を UI から進める。「間」は本体が持つ */
  advancePresentation(): void {
    switch (this.phase) {
      case 'hush':
        this.phase = 'reveal';
        break;
      case 'reveal':
        this.phase = 'verdict';
        break;
      case 'verdict':
        this.afterVerdict();
        return;
      default:
        return;
    }
    this.emit();
  }

  retryFromTitle(): void {
    this.phase = 'title';
    this.round = null;
    this.verdict = null;
    this.emit();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
    this.gateway.dispose();
  }

  /* ───────────────────────────── 内部 ───────────────────────────── */

  private slotsForSection(): number {
    const table = this.mode.slotsBySection;
    return clampSlots(table[this.sectionIndex] ?? table.at(-1) ?? 5);
  }

  /**
   * 配役は区画のあいだ据え置く。顔ぶれも嘘つきも変わらない。
   * これがあるから「ずっと本当のことを言って、ここぞで裏切る」が起こる。
   * 区画が変わると顔ぶれごと入れ替わり、積んだ読みは一度捨てられる。
   */
  private castingForSection(eligible: readonly AdvisorInfo[]): Casting {
    const stale =
      !this.sectionCasting ||
      this.sectionCastingIndex !== this.sectionIndex ||
      this.sectionCasting.speakerIds.some((id) => !eligible.some((a) => a.id === id));

    if (stale) {
      const speakerIds = castSpeakers({
        advisors: eligible,
        slots: this.slotsForSection(),
        mode: this.selectionMode,
        volunteers: this.gateway.volunteers(),
        nominated: this.nominated,
        rng: this.rng,
      });
      this.nominated = [];
      this.sectionCasting = {
        speakerIds,
        liarIds: castLiars(speakerIds, this.rng, this.mode.loneHonest),
      };
      this.sectionCastingIndex = this.sectionIndex;
      this.records.clear();
    }
    return this.sectionCasting as Casting;
  }

  /** 区画が進むほど択の多い部屋を出す。山札からは二度と同じ部屋を引かない */
  private drawRoom(): Room | null {
    if (this.deck.length === 0) return null;
    const want = RUN.minChoicesBySection[this.sectionIndex] ?? 5;
    let index = this.deck.findIndex((r) => r.choices.length >= want);
    if (index < 0) index = 0;
    const [room] = this.deck.splice(index, 1);
    return room ?? null;
  }

  private openRoom(): void {
    if (this.sectionIndex >= this.cfg.sections) {
      this.phase = 'cleared';
      this.round = null;
      this.emit();
      return;
    }
    const source = this.drawRoom();
    if (!source) {
      // 部屋を使い切った。踏破として扱う
      this.phase = 'cleared';
      this.round = null;
      this.emit();
      return;
    }

    this.currentSource = source;
    const timeLimitMs = Math.max(20_000, this.cfg.baseTimeMs - this.nextRoundPenaltyMs);
    this.nextRoundPenaltyMs = 0;

    this.roundCounter += 1;
    const roundId = `${source.id}#${this.roundCounter}`;
    const choices = shuffled(source.choices, this.rng);
    const fullRoom: Room = { ...source, choices };
    const room: PublicRoom = { id: source.id, theme: source.theme, prompt: source.prompt, choices };

    const eligible = this.advisors.filter((a) => !this.muted.has(a.id));
    const casting = this.castingForSection(eligible);
    this.currentCasting = casting;
    resetGuard(this.guard);

    // 死んで休んでいる仲間はこの部屋では喋らない
    const speakingIds = casting.speakerIds.filter((id) => !this.resting.has(id));
    const speakers = speakingIds
      .map((id) => eligible.find((a) => a.id === id))
      .filter((a): a is AdvisorInfo => !!a);

    // 配る前に決める。round に載せるので順序を間違えると前の部屋の値が残る
    const knowledge = dealKnowledge(
      choices, source.correct, casting, this.rng,
      knowledgeForSection(this.sectionIndex), this.mode.loneHonest,
      !!this.mode.allChallengers,
    );

    // 全員挑戦者モードでは、挑戦者自身にも部分情報が配られる
    this.ownCandidates = this.mode.allChallengers
      ? dealOwnKnowledge(choices, source.correct, this.mode.ownCandidates ?? 3, this.rng)
      : [];

    const deadlineAt = this.now() + timeLimitMs;
    this.round = {
      roundId,
      room,
      index: this.totalCleared,
      roomNumber: this.totalCleared + 1,
      sectionIndex: this.sectionIndex,
      timeLimitMs,
      deadlineAt,
      speakers,
      advice: [],
      silenceUsed: false,
      ownCandidates: this.ownCandidates,
      restingIds: [...this.resting],
    };
    this.liarLog = [...this.liarLog, { roundId, liarIds: casting.liarIds }];
    this.verdict = null;
    this.phase = 'choosing';

    // 誰が何を知っているかを配る。正解が入るのは嘘つきの手元と、協力者の候補の中だけ
    this.gateway.openRound({
      roundId, room: fullRoom,
      casting: { speakerIds: speakingIds, liarIds: casting.liarIds },
      knowledge, deadlineAt,
    });
    this.emit();
  }

  private receiveHint(hint: Hint): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (hint.roundId !== round.roundId) return;
    if (this.muted.has(hint.advisorId)) return;
    if (!this.currentCasting.speakerIds.includes(hint.advisorId)) return;

    const labels = round.room.choices.map((c) => localized(c.label));
    const checked = checkHint(this.guard, hint.advisorId, hint.text, this.now(), labels);
    if (!checked.ok) return;
    const text = checked.text;

    // 1部屋につき1人1通。書き直しは最新で上書きする
    const entry = {
      advisorId: hint.advisorId,
      advisorName: hint.advisorName,
      text,
      sentAt: hint.sentAt,
      record: this.records.get(hint.advisorId) ?? { hit: 0, miss: 0 },
    };
    const rest = round.advice.filter((a) => a.advisorId !== hint.advisorId);
    round.advice = [...rest, entry];
    this.emit();
  }

  private settle(round: RoundState, chosenId: string | null, timedOut: boolean): void {
    this.gateway.closeRound(round.roundId);
    const source = this.currentSource;
    const correctId = source?.correct ?? '';
    const survived = !timedOut && chosenId === correctId;
    if (!survived) this.lives -= 1;

    // 記録は「役」ではなく「振る舞い」で付ける。
    // 役を出すと隠れた配役をそのまま漏らしてしまう。挑戦者に見えるのは
    // 正解が明かされた後の「その人の助言が正解に触れていたか」だけ。
    // 嘘つきが信用を作るために本当のことを言った回は、正しく「正」に数えられる。
    const labels = round.room.choices.map((c) => localized(c.label));
    const correctLabel = source
      ? localized(source.choices.find((c) => c.id === correctId)?.label ?? { ja: '', en: '' })
      : '';
    for (const entry of round.advice) {
      const rec = this.records.get(entry.advisorId) ?? { hit: 0, miss: 0 };
      const truthful = wasTruthful(entry.text, correctLabel, labels);
      this.records.set(entry.advisorId, {
        hit: rec.hit + (truthful ? 1 : 0),
        miss: rec.miss + (truthful ? 0 : 1),
      });
    }

    const liars = this.currentCasting.liarIds
      .map((id) => this.advisors.find((a) => a.id === id))
      .filter((a): a is AdvisorInfo => !!a);

    // 全員挑戦者モード：仲間もそれぞれ選ぶ。結果で言行のずれが見える
    // 仲間の手はゲートウェイが持つ。人間の仲間が入っても本体は変わらない
    const party = this.mode.allChallengers ? this.collectParty(round, correctId) : [];
    this.resting = new Set(party.filter((p) => !p.survived).map((p) => p.id));

    this.verdict = {
      roundId: round.roundId,
      chosenId,
      correctId,
      survived,
      timedOut,
      deathMessage: source ? localized(source.deathMessage) : '',
      livesLeft: Math.max(0, this.lives),
      fatal: !survived && this.lives <= 0,
      liars,
      party,
    };
    this.phase = 'hush';
    this.emit();
  }

  /**
   * 仲間の選択を集める。
   * 本体は「誰が何を選んだか」を受け取って生死を決めるだけで、
   * その手が AI のものか人間のものかは知らない。
   * 返ってこなかった者は時間切れとして死ぬ。
   */
  private collectParty(
    round: RoundState,
    correctId: string,
  ): { id: string; name: string; chosenId: string; survived: boolean }[] {
    const picks = this.gateway.picks?.(round.roundId) ?? new Map<string, string>();
    return round.speakers.map((speaker) => {
      const chosenId = picks.get(speaker.id) ?? '';
      return { id: speaker.id, name: speaker.name, chosenId, survived: chosenId === correctId };
    });
  }

  private afterVerdict(): void {
    const verdict = this.verdict;
    if (!verdict) return;

    if (verdict.survived) {
      this.clearedInSection += 1;
      this.totalCleared += 1;
      if (this.clearedInSection >= this.cfg.roomsPerSection) {
        this.sectionIndex += 1;
        this.clearedInSection = 0;
        this.sectionCasting = null; // 顔ぶれごと入れ替える
      }
      this.openRoom();
      return;
    }
    if (verdict.fatal) {
      this.phase = 'gameover';
      this.emit();
      return;
    }
    // 死んだらその区画の最初に戻る。ただし部屋は引き直す（同じ部屋を続けて見せない）
    this.totalCleared -= this.clearedInSection;
    this.clearedInSection = 0;
    this.openRoom();
  }
}

/** 山札から引くための補助。テストと将来のパック切替で使う */
export function previewDeck(pack: RoomPack, seed: number, count: number): Room[] {
  return pickSome(pack.rooms, count, createRng(seed));
}
