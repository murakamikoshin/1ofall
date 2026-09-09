import type { AdvisorInfo, Hint, PublicRoom, Room, RoomPack } from './schema';
import { HINT_MAX_LENGTH, RUN, openLimitFor } from './limits';
import { castRound, clampSlots, type Casting, type SelectionMode } from './casting';
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

/** 誰かが助言を送ってきた、という事実だけ。中身は開くまで挑戦者に渡らない */
export interface Arrival {
  advisorId: string;
  advisorName: string;
  /** 過去の部屋で、この人の助言を開いた結果どうだったか */
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
  /** 発言枠に選ばれた面々。名前だけ見えている */
  speakers: readonly AdvisorInfo[];
  /** 届いた助言（中身は伏せてある） */
  arrivals: readonly Arrival[];
  /** 開封した助言。ここだけ本文が入る */
  opened: readonly Hint[];
  openLimit: number;
  silenceUsed: boolean;
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
}

export interface EngineConfig {
  pack: RoomPack;
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
  /** 部屋ごとの、伏せられた助言 */
  private inbox = new Map<string, Hint>();
  /** 開封した相手の当たり外れ。挑戦者が積む読み */
  private records = new Map<string, { hit: number; miss: number }>();

  private listeners = new Set<Listener>();
  private unsubs: Unsubscribe[] = [];

  constructor(config: EngineConfig) {
    this.pack = config.pack;
    this.gateway = config.gateway ?? new NullAdvisorGateway();
    this.now = config.now ?? (() => Date.now());
    this.rng = createRng(config.seed ?? (Date.now() & 0xffffffff));
    this.cfg = {
      lives: config.lives ?? RUN.lives,
      sections: config.sections ?? RUN.sections,
      roomsPerSection: config.roomsPerSection ?? RUN.roomsPerSection,
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

  /** 伏せられた助言を1通開く。開ける数には上限がある */
  openHint(advisorId: string): boolean {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return false;
    if (round.opened.length >= round.openLimit) return false;
    if (round.opened.some((h) => h.advisorId === advisorId)) return false;
    const hint = this.inbox.get(advisorId);
    if (!hint) return false;
    round.opened = [...round.opened, hint];
    this.emit();
    return true;
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
      round.opened = round.opened.filter((h) => h.advisorId !== advisorId);
      round.arrivals = round.arrivals.filter((a) => a.advisorId !== advisorId);
      this.inbox.delete(advisorId);
    } else {
      this.nextRoundPenaltyMs += this.cfg.penaltyTimeMs;
    }
    this.emit();
    return { hit };
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
    return clampSlots(RUN.slotsBySection[this.sectionIndex] ?? RUN.slotsBySection.at(-1) ?? 5);
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
    const casting = castRound({
      advisors: eligible,
      slots: this.slotsForSection(),
      mode: this.selectionMode,
      volunteers: this.gateway.volunteers(),
      nominated: this.nominated,
      rng: this.rng,
    });
    this.nominated = [];
    this.currentCasting = casting;
    this.inbox.clear();

    const speakers = casting.speakerIds
      .map((id) => eligible.find((a) => a.id === id))
      .filter((a): a is AdvisorInfo => !!a);

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
      arrivals: [],
      opened: [],
      openLimit: openLimitFor(speakers.length),
      silenceUsed: false,
    };
    this.liarLog = [...this.liarLog, { roundId, liarIds: casting.liarIds }];
    this.verdict = null;
    this.phase = 'choosing';

    // 正解は助言者側にだけ渡る
    this.gateway.openRound({ roundId, room: fullRoom, correct: source.correct, casting, deadlineAt });
    this.emit();
  }

  private receiveHint(hint: Hint): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (hint.roundId !== round.roundId) return;
    if (this.muted.has(hint.advisorId)) return;
    if (!this.currentCasting.speakerIds.includes(hint.advisorId)) return;
    const text = hint.text.trim();
    if (!text || text.length > HINT_MAX_LENGTH) return;

    // 1部屋につき1人1通。上書きで最新を残す
    const already = this.inbox.has(hint.advisorId);
    this.inbox.set(hint.advisorId, { ...hint, text });
    if (already) {
      // すでに開かれていたら本文も差し替える
      round.opened = round.opened.map((h) => (h.advisorId === hint.advisorId ? { ...hint, text } : h));
    } else {
      round.arrivals = [
        ...round.arrivals,
        {
          advisorId: hint.advisorId,
          advisorName: hint.advisorName,
          record: this.records.get(hint.advisorId) ?? { hit: 0, miss: 0 },
        },
      ];
    }
    this.emit();
  }

  private settle(round: RoundState, chosenId: string | null, timedOut: boolean): void {
    this.gateway.closeRound(round.roundId);
    const source = this.currentSource;
    const correctId = source?.correct ?? '';
    const survived = !timedOut && chosenId === correctId;
    if (!survived) this.lives -= 1;

    // 開いた相手が当たっていたか。次の部屋で「誰を開くか」の材料になる
    for (const hint of round.opened) {
      const rec = this.records.get(hint.advisorId) ?? { hit: 0, miss: 0 };
      const liar = this.currentCasting.liarIds.includes(hint.advisorId);
      this.records.set(hint.advisorId, {
        hit: rec.hit + (liar ? 0 : 1),
        miss: rec.miss + (liar ? 1 : 0),
      });
    }

    const liars = this.currentCasting.liarIds
      .map((id) => this.advisors.find((a) => a.id === id))
      .filter((a): a is AdvisorInfo => !!a);

    this.verdict = {
      roundId: round.roundId,
      chosenId,
      correctId,
      survived,
      timedOut,
      deathMessage: source?.deathMessage ?? '',
      livesLeft: Math.max(0, this.lives),
      fatal: !survived && this.lives <= 0,
      liars,
    };
    this.phase = 'hush';
    this.emit();
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
