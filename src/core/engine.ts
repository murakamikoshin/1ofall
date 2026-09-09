import type { AdvisorInfo, Hint, PublicRoom, Room, RoomPack } from './schema';
import { HINT_MAX_LENGTH } from './schema';
import { castRound, clampSlots, type Casting, type SelectionMode } from './casting';
import { createRng, shuffled, type Rng } from './rng';
import type { AdvisorGateway, Unsubscribe } from './advisor-gateway';
import { NullAdvisorGateway } from './advisor-gateway';

/**
 * ゲーム本体のロジック。DOM も通信も知らない純粋な状態機械。
 * 配信 / 友達内 / ソロで同じインスタンスが動く。差は AdvisorGateway だけ。
 */

export type Phase =
  | 'title'
  /** 部屋が出た。選択肢が見えている。助言者には正解が見えている */
  | 'choosing'
  /** 選択直後の無音。0.8秒。すべての音と動きを止める */
  | 'hush'
  /** 選んだ選択肢にライトが寄る */
  | 'reveal'
  /** 生死の確定 */
  | 'verdict'
  | 'gameover'
  | 'cleared';

export interface RoundState {
  roundId: string;
  /** 選択肢は毎回並びが変わる。同じ絵の同じ位置を覚えられないようにする。
   *  正解と死亡文は含まない（挑戦者側に答えが流れる経路を作らない） */
  room: PublicRoom;
  index: number;
  roomNumber: number;
  timeLimitMs: number;
  deadlineAt: number;
  hints: Hint[];
  casting: Casting;
  /** この部屋で排除を使ったか */
  silenceUsed: boolean;
}

export interface Verdict {
  roundId: string;
  chosenId: string | null;
  correctId: string;
  survived: boolean;
  /** 時間切れによる死 */
  timedOut: boolean;
  deathMessage: string;
  livesLeft: number;
  fatal: boolean;
}

export interface EngineConfig {
  pack: RoomPack;
  lives?: number;
  /** 区画の部屋数。死んだらその区画の最初に戻る */
  sectionSize?: number;
  baseTimeMs?: number;
  /** 排除を外したときの次の部屋の短縮量 */
  penaltyTimeMs?: number;
  seed?: number;
  gateway?: AdvisorGateway;
  /** 実時間を差し替え可能にしてテストできるようにする */
  now?: () => number;
}

export interface EngineState {
  phase: Phase;
  lives: number;
  maxLives: number;
  round: RoundState | null;
  verdict: Verdict | null;
  sectionIndex: number;
  clearedRooms: number;
  totalRooms: number;
  slots: number;
  selectionMode: SelectionMode;
  advisors: readonly AdvisorInfo[];
  /** 排除に成功して以降ヒントが届かない助言者 */
  mutedIds: readonly string[];
  /** ゲーム終了時に開示する嘘つき（部屋ごとの履歴） */
  liarLog: readonly { roundId: string; liarIds: readonly string[] }[];
}

export const DEFAULTS = {
  lives: 3,
  sectionSize: 5,
  baseTimeMs: 60_000,
  penaltyTimeMs: 15_000,
  hushMs: 800,
} as const;

type Listener = (state: EngineState) => void;

export class GameEngine {
  private readonly pack: RoomPack;
  private readonly order: readonly Room[];
  private readonly gateway: AdvisorGateway;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly cfg: Required<Pick<EngineConfig, 'lives' | 'sectionSize' | 'baseTimeMs' | 'penaltyTimeMs'>>;

  private phase: Phase = 'title';
  private lives: number;
  private index = 0;
  private sectionStart = 0;
  private round: RoundState | null = null;
  private verdict: Verdict | null = null;
  private slots = 5;
  private selectionMode: SelectionMode = 'lottery';
  private muted = new Set<string>();
  private nextRoundPenaltyMs = 0;
  private advisors: readonly AdvisorInfo[] = [];
  private liarLog: { roundId: string; liarIds: readonly string[] }[] = [];
  private nominated: string[] = [];
  private roundCounter = 0;

  private listeners = new Set<Listener>();
  private unsubs: Unsubscribe[] = [];

  constructor(config: EngineConfig) {
    this.pack = config.pack;
    this.gateway = config.gateway ?? new NullAdvisorGateway();
    this.now = config.now ?? (() => Date.now());
    this.rng = createRng(config.seed ?? (Date.now() & 0xffffffff));
    this.cfg = {
      lives: config.lives ?? DEFAULTS.lives,
      sectionSize: config.sectionSize ?? DEFAULTS.sectionSize,
      baseTimeMs: config.baseTimeMs ?? DEFAULTS.baseTimeMs,
      penaltyTimeMs: config.penaltyTimeMs ?? DEFAULTS.penaltyTimeMs,
    };
    this.lives = this.cfg.lives;
    this.order = this.pack.rooms;

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
      sectionIndex: Math.floor(this.sectionStart / this.cfg.sectionSize),
      clearedRooms: this.index,
      totalRooms: this.order.length,
      slots: this.slots,
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
    this.index = 0;
    this.sectionStart = 0;
    this.muted.clear();
    this.liarLog = [];
    this.nextRoundPenaltyMs = 0;
    this.openRoom();
  }

  setSlots(slots: number): void {
    this.slots = clampSlots(slots);
    this.emit();
  }

  setSelectionMode(mode: SelectionMode): void {
    this.selectionMode = mode;
    this.emit();
  }

  nominate(advisorIds: readonly string[]): void {
    this.nominated = advisorIds.slice(0, clampSlots(this.slots));
    this.emit();
  }

  /** 発言者を1人排除する。当たれば以降その人の発言は届かない。外したら次の部屋が短くなる */
  silence(advisorId: string): { hit: boolean } | null {
    const round = this.round;
    if (!round || this.phase !== 'choosing' || round.silenceUsed) return null;
    if (!round.casting.speakerIds.includes(advisorId)) return null;

    round.silenceUsed = true;
    const hit = round.casting.liarIds.includes(advisorId);
    if (hit) {
      this.muted.add(advisorId);
      round.hints = round.hints.filter((h) => h.advisorId !== advisorId);
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

  /** 制限時間切れ。挑戦者が選ばなかった場合も死ぬ */
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

  private openRoom(): void {
    const source = this.order[this.index];
    if (!source) {
      this.phase = 'cleared';
      this.round = null;
      this.emit();
      return;
    }

    const timeLimitMs = Math.max(15_000, this.cfg.baseTimeMs - this.nextRoundPenaltyMs);
    this.nextRoundPenaltyMs = 0;

    this.roundCounter += 1;
    const roundId = `${source.id}#${this.roundCounter}`;
    const choices = shuffled(source.choices, this.rng);
    const fullRoom: Room = { ...source, choices };
    const room: PublicRoom = { id: source.id, theme: source.theme, prompt: source.prompt, choices };

    const eligible = this.advisors.filter((a) => !this.muted.has(a.id));
    const casting = castRound({
      advisors: eligible,
      slots: this.slots,
      mode: this.selectionMode,
      volunteers: this.gateway.volunteers(),
      nominated: this.nominated,
      rng: this.rng,
    });
    this.nominated = [];

    const deadlineAt = this.now() + timeLimitMs;
    this.round = {
      roundId,
      room,
      index: this.index,
      roomNumber: this.index + 1,
      timeLimitMs,
      deadlineAt,
      hints: [],
      casting,
      silenceUsed: false,
    };
    this.liarLog = [...this.liarLog, { roundId, liarIds: casting.liarIds }];
    this.verdict = null;
    this.phase = 'choosing';

    // 助言者にだけ正解を配る。挑戦者クライアントはこの値を受け取らない
    // 正解は助言者側にだけ渡る
    this.gateway.openRound({ roundId, room: fullRoom, correct: source.correct, casting, deadlineAt });
    this.emit();
  }

  private receiveHint(hint: Hint): void {
    const round = this.round;
    if (!round || this.phase !== 'choosing') return;
    if (hint.roundId !== round.roundId) return;
    if (this.muted.has(hint.advisorId)) return;
    if (!round.casting.speakerIds.includes(hint.advisorId)) return;
    const text = hint.text.trim();
    if (!text || text.length > HINT_MAX_LENGTH) return;

    // 1部屋につき1人1通。上書きで最新を残す（連投で画面を埋められないように）
    const next = round.hints.filter((h) => h.advisorId !== hint.advisorId);
    next.push({ ...hint, text });
    round.hints = next;
    this.emit();
  }

  private settle(round: RoundState, chosenId: string | null, timedOut: boolean): void {
    this.gateway.closeRound(round.roundId);
    const source = this.order[round.index];
    const correctId = source?.correct ?? '';
    const survived = !timedOut && chosenId === correctId;
    if (!survived) this.lives -= 1;

    this.verdict = {
      roundId: round.roundId,
      chosenId,
      correctId,
      survived,
      timedOut,
      deathMessage: source?.deathMessage ?? '',
      livesLeft: Math.max(0, this.lives),
      fatal: !survived && this.lives <= 0,
    };
    this.phase = 'hush';
    this.emit();
  }

  private afterVerdict(): void {
    const verdict = this.verdict;
    if (!verdict) return;

    if (verdict.survived) {
      this.index += 1;
      if (this.index % this.cfg.sectionSize === 0) this.sectionStart = this.index;
      this.openRoom();
      return;
    }
    if (verdict.fatal) {
      this.phase = 'gameover';
      this.emit();
      return;
    }
    // 死んだらその区画の最初に戻る。進行は失うが挑戦は続く
    this.index = this.sectionStart;
    this.openRoom();
  }
}
