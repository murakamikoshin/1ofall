import type { AdvisorInfo, Hint, Knowledge, PublicRoom, Room, RoomPack } from './schema';
import { LIAR_FRACTION, RUN, knowledgeForSection, STANDARD, type ModeConfig } from './limits';
import { localized, strings } from '../i18n';
import {
  checkHint, createHintGuard, createReportBook, fileReport, reportCount, resetGuard, wasTruthful,
  type HintGuardState, type ReportBook,
} from './moderation';
import {
  castLiars, castSpeakers, clampSlots, dealAudienceKnowledge, dealKnowledge, dealOwnKnowledge,
  type Casting, type SelectionMode,
} from './casting';
import { createRng, shuffled, pickSome, type Rng } from './rng';
import type { AdvisorGateway, Unsubscribe } from './advisor-gateway';
import { NullAdvisorGateway } from './advisor-gateway';
import { resolveTruth } from './name-calling';

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
  /** 扉について言ったのか、人を指したのか。既定は扉 */
  kind?: 'door' | 'call' | undefined;
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
   * この部屋から顔ぶれと配役が入れ替わった。
   * 記録が白紙に戻るので、黙って消すと不具合に見える。画面で言う
   */
  freshCast: boolean;
  /**
   * 全員挑戦者モードで、挑戦者自身に配られた部分情報。
   * 「このどれかが生きる」。全員を疑っても手詰まりにならないための足場。
   */
  ownCandidates: readonly string[];
  /** 死んで今回休んでいる仲間 */
  restingIds: readonly string[];
  /**
   * 発言枠の外にいる人たちの投票。選択肢ID → 票数。多い順。
   *
   * 配信で視聴者が1000人いると発言できるのは8人で、
   * 残りの99%は見ているだけだった。**一番面白い役に誰も当たらない。**
   * 枠外にも一票ずつ渡す。
   *
   * 挑戦者に見えるが**当てにならない**。枠外にも嘘つきが混ざっていて、
   * 嘘つきは全員が同じ罠に投じるので票は罠に集まりやすい。
   * 「群れに従うと死ぬ」がそのまま形になる。
   */
  crowd: readonly { choiceId: string; votes: number }[];
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
  /**
   * 一番名の挙がった扉を選んで死んだか。
   *
   * このゲームで一番覚えてほしいのは「群れに従うと死ぬ」こと
   * （一番票が集まった選択肢の的中率は85%）。
   * 死んだ理由がそれだったときだけ、その場で言う。
   * 手引きで読んだ規則が、痛みと結びつくのはここしかない。
   */
  followedCrowd: boolean;
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
  /** このモードで「黙らせる」が使えるか */
  canSilence: boolean;
  /**
   * 黙らせて当たった相手。この区画のあいだ嘘つきだと確定している。
   * 画面に残さないと、せっかく得た情報を人間の記憶に押しつけることになる。
   */
  confirmedLiars: readonly string[];
  /**
   * 部屋ごとの嘘つき。終わったあとの開示に使う。
   * 区画も持つ：**全部まとめて名前を並べると、卓を組み替えるたびに
   * 名前が増えて「ほぼ全員が嘘つき」という無意味な一覧になる。**
   */
  liarLog: readonly { roundId: string; sectionIndex: number; liarIds: readonly string[] }[];
}

export const HUSH_MS = 800;

/** その部屋の罠を、配り終えた知識から読み戻す（配役の中にしか無い） */
function trapFrom(knowledge: ReadonlyMap<string, Knowledge>): string | null {
  for (const k of knowledge.values()) {
    if (k.kind === 'liar' || k.kind === 'trapper') return k.trap;
  }
  return null;
}

/** 部屋ごとに別の乱数を立てるための種。本編の目を消費しない */
function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
  private pausedAt: number | null = null;
  private verdict: Verdict | null = null;
  private selectionMode: SelectionMode = 'lottery';
  private muted = new Set<string>();
  /**
   * この区画で黙らせた相手。区画が変われば顔ぶれごと入れ替わるので戻る。
   * 通報による muted（名簿から外れる）とは別のもの。
   */
  private silencedThisSection = new Set<string>();
  private nextRoundPenaltyMs = 0;
  private advisors: readonly AdvisorInfo[] = [];
  private liarLog: { roundId: string; sectionIndex: number; liarIds: readonly string[] }[] = [];
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
  /** 直前に配役を引き直したか。次の部屋の画面で一度だけ知らせる */
  private castJustChanged = false;
  /** 文字数・連投・NGワードの検査。段階4のサーバーも同じものを通す */
  private guard: HintGuardState = createHintGuard();
  private rejectionListeners = new Set<(advisorId: string, reason: string) => void>();
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
      this.gateway.onCall?.((call) => this.point(call.advisorId, call.targetId, call.doubt)) ?? (() => {}),
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
    const round = this.round ? { ...this.round, crowd: this.crowdOf(this.round.roundId) } : null;
    return {
      phase: this.phase,
      lives: this.lives,
      maxLives: this.cfg.lives,
      round,
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
      canSilence: !!this.mode.canSilence,
      confirmedLiars: [...this.silencedThisSection],
      liarLog: this.liarLog,
    };
  }

  /** 枠外の票を並べる。多い順 */
  private crowdOf(roundId: string): { choiceId: string; votes: number }[] {
    const votes = this.gateway.crowdVotes?.(roundId);
    if (!votes || votes.size === 0) return [];
    return [...votes.entries()]
      .map(([choiceId, n]) => ({ choiceId, votes: n }))
      .sort((a, b) => b.votes - a.votes);
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
    if (!this.mode.canSilence) return null;
    const round = this.round;
    if (!round || this.phase !== 'choosing' || round.silenceUsed) return null;
    if (!round.speakers.some((s) => s.id === advisorId)) return null;

    round.silenceUsed = true;
    const hit = this.currentCasting.liarIds.includes(advisorId);
    if (hit) {
      // **この区画のあいだ黙らせる。** ただし席からは追い出さない。
      //
      // 以前は名簿から外していたので、席が入れ替わってそのぶん記録が消えた。
      // 崖っぷちは記録が唯一の道具なので、探す道具を使うほど
      // 探した成果が消えるという形になっていた
      // （実測でほぼ全部屋が信用0.50＝当てずっぽう。当たり率も54%まで落ちていた）。
      //
      // 席を残したまま声だけ止めると、顔ぶれと記録が据わる。
      // 当たり率は54%→90%に戻った。
      round.advice = round.advice.filter((a) => a.advisorId !== advisorId);
      this.silencedThisSection.add(advisorId);
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
  /**
   * 通報。
   * 挑戦者（部屋の主）の通報は一件で効く。自分の部屋だから。
   * 助言者どうしの通報は積み上がってから効く（結託で人を消せないように）。
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
    // 部屋の主の通報は一件で効く
    const byOwner = reporterId === 'challenger';
    if (result.accepted && (result.autoMuted || byOwner)) {
      this.muted.add(targetId);
      if (round) round.advice = round.advice.filter((a) => a.advisorId !== targetId);
      // 名簿から外れたので席が空く。空いた席だけ入れ替わる（castingForSection）
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

  /**
   * 手引きを開いているあいだ持ち時間を止める。
   * 締切をそのぶん後ろへずらすだけで、盤面は動かさない。
   * 助言者側の締切は延ばさない（読んでいるあいだも助言は届いてよい）。
   */
  pause(): void {
    if (this.pausedAt !== null) return;
    if (this.phase !== 'choosing' || !this.round) return;
    this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    const elapsed = this.now() - this.pausedAt;
    this.pausedAt = null;
    if (!this.round || this.phase !== 'choosing') return;
    this.round = { ...this.round, deadlineAt: this.round.deadlineAt + elapsed };
    this.emit();
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /** ローカルの本体は時間を止められる。遠くの部屋は止められない */
  readonly canPause = true;

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
    this.rejectionListeners.clear();
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
    const current = this.sectionCasting;
    if (!current || this.sectionCastingIndex !== this.sectionIndex) {
      this.castJustChanged = true;
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
      this.silencedThisSection.clear();
      return this.sectionCasting;
    }

    // 誰かを黙らせた等で席が空いた。
    //
    // **その席だけ入れ替える。** 前は顔ぶれごと引き直していたので、
    // 嘘つきを黙らせるたびに積んだ記録が消えていた。
    // 崖っぷちは「信じられる一人を探す」遊びなのに、
    // 探す道具を使うと探した結果が消える、という形になっていた。
    const gone = current.speakerIds.filter((id) => !eligible.some((a) => a.id === id));
    if (gone.length === 0) return current;

    const kept = current.speakerIds.filter((id) => !gone.includes(id));
    const pool = eligible.filter((a) => !kept.includes(a.id)).map((a) => a.id);
    const added = pickSome(pool, Math.min(gone.length, pool.length), this.rng);

    // 抜けた席の役をそのまま引き継ぐ。嘘つきの人数を保つ
    // （崖っぷちなら正直者はいつも一人のまま）
    const goneLiars = gone.filter((id) => current.liarIds.includes(id)).length;
    const keptLiars = current.liarIds.filter((id) => kept.includes(id));
    const newLiars = added.slice(0, Math.min(goneLiars, added.length));

    this.sectionCasting = {
      speakerIds: [...kept, ...added],
      liarIds: [...keptLiars, ...newLiars],
    };
    for (const id of gone) this.records.delete(id);
    return this.sectionCasting;
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

    // 死んで休んでいる仲間はこの部屋では喋らない。
    // ただし全員が同時に死ぬと誰も喋らない部屋になるので、必ず数人は残す。
    const speakingIds = this.applyResting(casting.speakerIds);
    const speakers = speakingIds
      .map((id) => eligible.find((a) => a.id === id))
      .filter((a): a is AdvisorInfo => !!a);

    // 配る前に決める。round に載せるので順序を間違えると前の部屋の値が残る
    const knowledge = dealKnowledge(
      choices, source.correct, casting, this.rng,
      knowledgeForSection(this.sectionIndex), this.mode.loneHonest,
      !!this.mode.allChallengers,
    );

    // 発言枠の外の人にも同じものを配る。「見えているのに言えない」を作るため。
    // 勝敗には効かない（枠外の助言は届かず、枠は区画のあいだ動かない）ので、
    // 本編の目が動かないよう乱数は別に持つ
    const outsiders = eligible.map((a) => a.id).filter((id) => !knowledge.has(id));
    if (outsiders.length > 0) {
      const trap = trapFrom(knowledge) ?? choices.find((c) => c.id !== source.correct)?.id ?? source.correct;
      const side = createRng(hashString(roundId));
      for (const [id, k] of dealAudienceKnowledge(
        choices, source.correct, trap, outsiders, side,
        knowledgeForSection(this.sectionIndex), LIAR_FRACTION, !!this.mode.allChallengers,
      )) {
        knowledge.set(id, k);
      }
    }

    // 全員挑戦者モードでは、挑戦者自身にも部分情報が配られる
    this.ownCandidates = this.mode.allChallengers
      ? dealOwnKnowledge(choices, source.correct, this.mode.ownCandidates ?? 3, this.rng)
      : [];

    const deadlineAt = this.now() + timeLimitMs;
    this.pausedAt = null;
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
      crowd: [],
      freshCast: this.castJustChanged,
      ownCandidates: this.ownCandidates,
      restingIds: [...this.resting],
    };
    this.castJustChanged = false;
    this.liarLog = [...this.liarLog, { roundId, sectionIndex: this.sectionIndex, liarIds: casting.liarIds }];
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

  /**
   * 助言が弾かれたことを外へ知らせる。
   * ローカルでは要らない（送る前に同じ検査を通しているので画面に出ている）が、
   * ネットワーク越しだと弾いたのはサーバーなので、本人に返す口が要る。
   */
  onHintRejected(listener: (advisorId: string, reason: string) => void): Unsubscribe {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  private rejectHint(advisorId: string, reason: string): void {
    for (const l of this.rejectionListeners) l(advisorId, reason);
  }

  private receiveHint(hint: Hint): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (hint.roundId !== round.roundId) return;
    if (this.muted.has(hint.advisorId)) return;
    if (this.silencedThisSection.has(hint.advisorId)) return;
    if (!this.currentCasting.speakerIds.includes(hint.advisorId)) {
      this.rejectHint(hint.advisorId, 'notSpeaking');
      return;
    }

    const labels = round.room.choices.map((c) => localized(c.label));
    const checked = checkHint(this.guard, hint.advisorId, hint.text, this.now(), labels);
    if (!checked.ok) {
      this.rejectHint(hint.advisorId, checked.reason);
      return;
    }
    const text = checked.text;

    this.addAdvice(round, {
      advisorId: hint.advisorId,
      advisorName: hint.advisorName,
      text,
      sentAt: hint.sentAt,
      record: this.records.get(hint.advisorId) ?? { hit: 0, miss: 0 },
      kind: 'door',
    });
  }

  /** 1部屋につき、口ごとに1通。書き直しは最新で上書きする */
  private addAdvice(round: RoundState, entry: Advice): void {
    const kind = entry.kind ?? 'door';
    const rest = round.advice.filter((a) => !(a.advisorId === entry.advisorId && (a.kind ?? 'door') === kind));
    round.advice = [...rest, entry];
    this.emit();
  }

  /**
   * 人を指す。「あいつは嘘だ」。
   *
   * 扉について言う口とは別なので、指しても扉の情報は減らない。
   * 文面はここで組む（送らせない）ので、暴言の検査を通す必要が無い。
   *
   * 実測（tools/name-call.mjs）：**撃たれた者ほど正解を口にしている。**
   * 崖っぷちで二人から撃たれた者は 97.7% が正解を口にしていた（撃たれて
   * いない者は 28.2%）。嘘つきは全員が同じ正解を知っているので、
   * 真実を言った者に群がるしかない。「群れに従うと死ぬ」の裏返しになる。
   */
  point(advisorId: string, targetId: string, doubt: boolean): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (advisorId === targetId) return;
    if (this.muted.has(advisorId) || this.silencedThisSection.has(advisorId)) return;
    if (!this.currentCasting.speakerIds.includes(advisorId)) {
      this.rejectHint(advisorId, 'notSpeaking');
      return;
    }
    // 指せるのは、この部屋で扉について何か言った者だけ。
    // 黙っている相手を撃てると、言っていないことで裁かれる形になる
    const target = round.advice.find((a) => a.advisorId === targetId && (a.kind ?? 'door') === 'door');
    if (!target) return;
    // **自分も先に扉について言っていること。**
    // 撃つだけで済むなら、自分の言葉を晒さずに人を潰せてしまう。
    // 先に自分の一言を置かせれば、撃つ側も同じだけ裁かれる場に立つ
    const spoke = round.advice.some((a) => a.advisorId === advisorId && (a.kind ?? 'door') === 'door');
    if (!spoke) {
      this.rejectHint(advisorId, 'speakFirst');
      return;
    }
    const me = this.advisors.find((a) => a.id === advisorId);
    const shapes = doubt ? strings().hints.doubt : strings().hints.back;
    const shape = shapes[Math.floor(this.rng() * shapes.length)] ?? shapes[0];
    if (!shape) return;
    this.addAdvice(round, {
      advisorId,
      advisorName: me?.name ?? '',
      text: shape(target.advisorName),
      sentAt: this.now(),
      record: this.records.get(advisorId) ?? { hit: 0, miss: 0 },
      kind: 'call',
    });
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
    // 人を指した助言（「あいつは嘘だ」）は扉に触れていないので、
    // 指した相手の言が嘘だったかで正誤を決める。辿れないものは記録を付けない
    const truth = resolveTruth(
      round.advice.map((a) => ({ id: a.advisorId, name: a.advisorName, text: a.text, kind: a.kind ?? 'door' })),
      (text) => wasTruthful(text, correctLabel, labels),
      round.room.choices,
    );
    for (const { id: advisorId, truthful } of truth) {
      const rec = this.records.get(advisorId) ?? { hit: 0, miss: 0 };
      this.records.set(advisorId, {
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
      followedCrowd: !survived && chosenId !== null && this.wasCrowdChoice(round, chosenId),
    };
    this.phase = 'hush';
    this.emit();
  }

  /**
   * 休みを適用する。全員が休むと助言がゼロの部屋になってしまうので、
   * 最低人数を割り込むぶんは休みを取り消す（早く死んだ者から復帰する）。
   */
  private applyResting(speakerIds: readonly string[]): readonly string[] {
    const MIN_SPEAKERS = 3;
    if (this.resting.size === 0) return speakerIds;

    const awake = speakerIds.filter((id) => !this.resting.has(id));
    if (awake.length >= Math.min(MIN_SPEAKERS, speakerIds.length)) return awake;

    const need = Math.min(MIN_SPEAKERS, speakerIds.length) - awake.length;
    const recalled = speakerIds.filter((id) => this.resting.has(id)).slice(0, need);
    for (const id of recalled) this.resting.delete(id);
    return speakerIds.filter((id) => !this.resting.has(id));
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

  /**
   * その扉が「一番名の挙がった扉」だったか。
   * 同点で一番なら群れとは言えないので、単独一番のときだけ真。
   */
  private wasCrowdChoice(round: RoundState, chosenId: string): boolean {
    const labels = round.room.choices.map((c) => ({ id: c.id, label: localized(c.label) }));
    const count = new Map(labels.map((c) => [c.id, 0]));
    for (const advice of round.advice) {
      if ((advice.kind ?? 'door') !== 'door') continue;
      for (const c of labels) {
        if (advice.text.includes(c.label)) count.set(c.id, (count.get(c.id) ?? 0) + 1);
      }
    }
    const mine = count.get(chosenId) ?? 0;
    if (mine < 2) return false;
    return [...count.entries()].every(([id, n]) => id === chosenId || n < mine);
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
    // 死んだらその区画の最初に戻る。ただし部屋は引き直す（同じ部屋を続けて見せない）。
    //
    // **顔ぶれと配役も引き直す。** 残したままだと、死ぬたびに同じ相手の
    // 記録が積み上がって、区画をやり直すほど読みが楽になる。
    // 実際に遊ぶと、区画1に16部屋いたところで「正14 嘘1」と「正3 嘘12」に
    // 割れきって、あとは一番上の数字に従うだけの作業になっていた。
    // 死んだら賭場は席を組み替える、という筋でもある。
    this.totalCleared -= this.clearedInSection;
    this.clearedInSection = 0;
    this.sectionCasting = null;
    this.records.clear();
    this.openRoom();
  }
}

/** 山札から引くための補助。テストと将来のパック切替で使う */
export function previewDeck(pack: RoomPack, seed: number, count: number): Room[] {
  return pickSome(pack.rooms, count, createRng(seed));
}
