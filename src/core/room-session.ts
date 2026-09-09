import { GameEngine, type EngineState } from './engine';
import { SocketAdvisorGateway } from './socket-gateway';
import { CompositeAdvisorGateway } from './composite-gateway';
import { MODES, type ModeId } from './limits';
import { ClientMessageSchema, PublicRoomSchema, type RoomPack, type ServerMessage } from './schema';
import { setLocale, type Locale } from '../i18n';
import type { RoundBriefing } from './advisor-gateway';

/**
 * 部屋ひとつぶんの進行。**通信を知らない。**
 *
 * PartyKit の Durable Object から呼ばれることを想定しているが、
 * 送受信は Sink 越しなので、繋がずにそのまま試験できる（tools/test-party.mjs）。
 *
 * ここが権威。ゲーム本体をサーバーで回すのは、
 * 全員挑戦者モードで見知らぬ相手と遊ぶときに、
 * 誰か一人の端末を信じる形にしたくないから。
 */

export interface Sink {
  /** 一人あてに送る。知識はこちらでしか送らない */
  send(connectionId: string, message: ServerMessage): void;
  broadcast(message: ServerMessage): void;
}

export interface RoomSessionOptions {
  pack: RoomPack;
  sink: Sink;
  /** 人間が足りないぶんを埋める AI の人数 */
  aiCount?: number;
  now?: () => number;
  seed?: number;
}

export class RoomSession {
  private readonly pack: RoomPack;
  private readonly sink: Sink;
  private readonly aiCount: number;
  private readonly now: () => number;
  private readonly seed: number | undefined;

  private engine: GameEngine | null = null;
  private humans = new SocketAdvisorGateway();
  private locale: Locale = 'ja';
  private modeId: ModeId = 'standard';

  /** 最初に繋いだ者が挑戦者。以降は助言者 */
  private challengerId: string | null = null;
  private connections = new Set<string>();
  private briefing: RoundBriefing | null = null;
  private unsubs: (() => void)[] = [];

  constructor(options: RoomSessionOptions) {
    this.pack = options.pack;
    this.sink = options.sink;
    this.aiCount = options.aiCount ?? 12;
    this.now = options.now ?? (() => Date.now());
    this.seed = options.seed;
    this.humans = new SocketAdvisorGateway({ now: this.now });
  }

  /* ───────────────────────────── 接続 ───────────────────────────── */

  connect(connectionId: string): void {
    this.connections.add(connectionId);
    if (this.challengerId === null) {
      this.challengerId = connectionId;
      return;
    }
    this.humans.join(connectionId, undefined, this.defaultName(connectionId));
    this.pushState();
    this.pushRoundTo(connectionId);
  }

  disconnect(connectionId: string): void {
    this.connections.delete(connectionId);
    this.humans.leave(connectionId);
    if (this.challengerId === connectionId) {
      // 挑戦者が落ちたら部屋は畳む。残った者に AI が続きを見せても意味がない
      this.challengerId = null;
      this.stop();
    }
    this.pushState();
  }

  /** 繋がっている人数（AI は含めない） */
  get size(): number {
    return this.connections.size;
  }

  /* ─────────────────────── 受信（信用できない側） ─────────────────────── */

  receive(connectionId: string, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.fail(connectionId, 'badMessage');
      return;
    }
    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.fail(connectionId, 'badMessage');
      return;
    }
    const msg = parsed.data;

    // 言語は部屋ごと。助言の字数と禁止語の判定がこれを見るので、
    // 触る直前に必ず入れ直す（同じ実行環境に別の部屋が同居しうる）
    setLocale(this.locale);

    const isChallenger = connectionId === this.challengerId;

    switch (msg.t) {
      case 'advisor/join': {
        if (isChallenger) return;
        this.humans.join(connectionId, msg.name, this.defaultName(connectionId));
        this.pushState();
        this.pushRoundTo(connectionId);
        return;
      }
      case 'advisor/hint':
        this.humans.hint(connectionId, msg.roundId, msg.text);
        return;
      case 'advisor/volunteer':
        this.humans.volunteer(connectionId, msg.roundId);
        return;
      case 'party/pick':
        this.humans.pick(connectionId, msg.roundId, msg.choiceId);
        return;
      case 'advisor/report':
        this.engine?.report(connectionId, msg.targetId, msg.text);
        return;

      case 'challenger/start': {
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.locale = msg.locale ?? this.locale;
        setLocale(this.locale);
        this.modeId = msg.mode;
        this.start();
        return;
      }
      case 'challenger/choose':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.choose(msg.choiceId);
        return;
      case 'challenger/silence':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.silence(msg.advisorId);
        return;
      case 'challenger/report':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.report('challenger', msg.advisorId, msg.text);
        return;
      case 'challenger/setSelectionMode':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.setSelectionMode(msg.mode);
        return;
      case 'challenger/nominate':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.nominate(msg.advisorIds);
        return;
      case 'challenger/advance':
        if (!isChallenger) return this.fail(connectionId, 'notChallenger');
        this.engine?.advancePresentation();
        return;
    }
  }

  /* ───────────────────────────── 進行 ───────────────────────────── */

  private start(): void {
    this.stop();
    const mode = MODES[this.modeId];
    const gateway = new CompositeAdvisorGateway({
      human: this.humans,
      minAdvisors: this.aiCount,
      mode,
    });
    const engine = new GameEngine({
      pack: this.pack,
      mode,
      gateway,
      ...(this.seed === undefined ? {} : { seed: this.seed }),
      now: this.now,
    });
    this.engine = engine;

    this.unsubs.push(
      this.humans.onRound((briefing) => {
        this.briefing = briefing;
        for (const id of this.connections) this.pushRoundTo(id);
      }),
      engine.subscribe((state) => this.onEngineState(state)),
      engine.onHintRejected((advisorId, reason) => this.fail(advisorId, reason)),
    );
    engine.start();
  }

  private stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.engine?.dispose();
    this.engine = null;
    this.briefing = null;
  }

  private lastPhase = '';
  private lastRoundId = '';
  private lastHintCount = -1;

  private onEngineState(state: EngineState): void {
    this.pushState(state);

    const round = state.round;
    if (round && round.roundId !== this.lastRoundId) {
      this.lastRoundId = round.roundId;
      this.lastHintCount = -1;
    }
    // 助言は増えたときだけ流す。1文字ごとに全員へ配らない
    if (round && round.advice.length !== this.lastHintCount) {
      this.lastHintCount = round.advice.length;
      this.sink.broadcast({
        t: 'round/hints',
        roundId: round.roundId,
        hints: round.advice.map((a) => ({
          advisorId: a.advisorId,
          advisorName: a.advisorName,
          text: a.text,
          roundId: round.roundId,
          sentAt: a.sentAt,
        })),
      });
    }

    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase;
      const v = state.verdict;
      if ((state.phase === 'verdict' || state.phase === 'gameover' || state.phase === 'cleared') && v) {
        this.sink.broadcast({
          t: 'round/result',
          roundId: v.roundId,
          chosen: v.chosenId ?? '',
          correct: v.correctId,
          survived: v.survived,
          ...(v.party.length ? { picks: v.party.map((p) => ({ advisorId: p.id, choiceId: p.chosenId })) } : {}),
        });
      }
      if (state.phase === 'gameover' || state.phase === 'cleared') {
        const liarIds = new Set(state.liarLog.flatMap((r) => [...r.liarIds]));
        this.sink.broadcast({
          t: 'game/over',
          cleared: state.phase === 'cleared',
          liars: state.advisors.filter((a) => liarIds.has(a.id)),
        });
      }
    }
  }

  private pushState(state?: EngineState): void {
    const s = state ?? this.engine?.snapshot();
    if (!s) return;
    this.sink.broadcast({
      t: 'room/state',
      phase: s.phase,
      mode: this.modeId,
      lives: s.lives,
      roomNumber: s.round?.roomNumber ?? 0,
      sectionIndex: s.sectionIndex,
      sectionCount: s.sectionCount,
      roster: [...s.advisors],
    });
  }

  /**
   * 部屋の中身をその人あてに送る。
   * **知識が乗るのはここだけ**で、しかも一人ぶんずつしか乗らない。
   * 部屋そのものは PublicRoomSchema を通して正解と死亡文を落としてから送る。
   */
  private pushRoundTo(connectionId: string): void {
    const briefing = this.briefing;
    const state = this.engine?.snapshot();
    const round = state?.round;
    if (!briefing || !round || state?.phase !== 'choosing') return;

    const room = PublicRoomSchema.parse(briefing.room);
    const base = {
      t: 'round/open' as const,
      roundId: round.roundId,
      room,
      deadlineAt: round.deadlineAt,
      serverNow: this.now(),
    };

    if (connectionId === this.challengerId) {
      this.sink.send(connectionId, {
        ...base,
        ...(round.ownCandidates.length ? { ownCandidates: [...round.ownCandidates] } : {}),
        ...(round.restingIds.length ? { restingIds: [...round.restingIds] } : {}),
      });
      return;
    }

    const knowledge = briefing.knowledge.get(connectionId);
    this.sink.send(connectionId, {
      ...base,
      ...(knowledge ? { knowledge } : {}),
      isSpeaker: briefing.casting.speakerIds.includes(connectionId),
    });
  }

  private fail(connectionId: string, code: string): void {
    this.sink.send(connectionId, { t: 'error', code, message: code });
  }

  private defaultName(connectionId: string): string {
    return `名無し${connectionId.slice(-3)}`;
  }
}
