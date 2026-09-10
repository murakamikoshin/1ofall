import { GameEngine, type EngineState } from './engine';
import { SocketAdvisorGateway } from './socket-gateway';
import { CompositeAdvisorGateway } from './composite-gateway';
import { MODES, PARTY, PARTY_MIN_SEATS, PARTY_MAX_SEATS, type ModeId } from './limits';
import { PartyEngine, type PartyMember, type PartyState } from './party-engine';
import { companionNames } from './companion-names';
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
  private party: PartyEngine | null = null;
  private partyTimers: ReturnType<typeof setTimeout>[] = [];
  private partyRoundPlanned: string | null = null;
  private partyRushRound: string | null = null;
  private humans = new SocketAdvisorGateway();
  private locale: Locale = 'ja';
  private modeId: ModeId = 'standard';

  /** 最初に繋いだ者が挑戦者。以降は助言者 */
  private challengerId: string | null = null;
  private connections = new Set<string>();
  /** 名乗った名前。主も含めて覚える */
  private names = new Map<string, string>();
  private briefing: RoundBriefing | null = null;
  private deadlineTimer: number | null = null;
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
    this.names.delete(connectionId);
    this.humans.leave(connectionId);
    this.party?.leave(connectionId);
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
        // 名乗りは主も含めて受ける。全員挑戦者では主も一人の参加者
        const chosen = msg.name?.trim();
        if (chosen) this.names.set(connectionId, chosen);
        if (isChallenger) {
          this.pushState();
          return;
        }
        this.humans.join(connectionId, msg.name, this.defaultName(connectionId));
        this.pushState();
        this.pushRoundTo(connectionId);
        return;
      }
      case 'advisor/hint':
        if (this.party) {
          const result = this.party.hint(connectionId, msg.text);
          if (!result.ok) this.fail(connectionId, result.reason);
          return;
        }
        this.humans.hint(connectionId, msg.roundId, msg.text);
        return;
      case 'advisor/volunteer':
        this.humans.volunteer(connectionId, msg.roundId);
        return;
      case 'party/pick':
        if (this.party) {
          this.party.pick(connectionId, msg.choiceId);
          return;
        }
        this.humans.pick(connectionId, msg.roundId, msg.choiceId);
        return;
      case 'advisor/report':
        if (this.party) this.party.report(connectionId, msg.targetId, msg.text);
        else this.engine?.report(connectionId, msg.targetId, msg.text);
        return;

      case 'challenger/start': {
        // 野良では誰が最初に繋がるか決められないので、全員が言い出す。
        // 実際に開けるのは最初に繋いだ一人だけで、残りは黙って断られる
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
        // 全員挑戦者では段を刻むのはサーバー。画面からの合図は取らない
        if (!this.party) this.engine?.advancePresentation();
        return;
    }
  }

  /* ───────────────────────────── 進行 ───────────────────────────── */

  private start(): void {
    this.stop();
    if (this.modeId === 'party') {
      this.startParty();
      return;
    }
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
        this.armDeadline(briefing.roundId, briefing.deadlineAt);
      }),
      engine.subscribe((state) => this.onEngineState(state)),
      engine.onHintRejected((advisorId, reason) => this.fail(advisorId, reason)),
    );
    engine.start();
  }

  /**
   * 締切はサーバーが持つ。
   * 挑戦者の画面に任せると、閉じられた部屋がそのまま止まって
   * 助言者が待たされ続ける。
   */
  private armDeadline(roundId: string, deadlineAt: number): void {
    this.clearDeadline();
    const wait = Math.max(0, deadlineAt - this.now());
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      const round = this.engine?.snapshot().round;
      if (round?.roundId === roundId) this.engine?.timeUp();
    }, wait + 250) as unknown as number;
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
  }

  /* ───────────────────── 全員挑戦者モード（対等） ───────────────────── */

  /**
   * 全員挑戦者は命が人ごとで、演出も全員で揃える必要がある。
   * だから**段を進めるのもサーバー**。挑戦者の画面任せにしない。
   */
  private startParty(): void {
    const names = companionNames();
    const members: PartyMember[] = [...this.connections]
      .slice(0, PARTY_MAX_SEATS)
      .map((id, i) => ({
        id,
        name:
          this.names.get(id) ??
          this.humans.roster().find((a) => a.id === id)?.name ??
          names[i % names.length] ??
          `?${i}`,
        kind: 'human' as const,
      }));
    // 4人だと正直な声が2つしか無く運任せになる。足りないぶんは AI で埋める
    let i = 0;
    while (members.length < PARTY_MIN_SEATS) {
      members.push({ id: `ai_${i}`, name: names[(members.length + i) % names.length] ?? `AI${i}`, kind: 'ai' });
      i += 1;
    }

    const party = new PartyEngine({ pack: this.pack, members, mode: PARTY, now: this.now });
    this.party = party;
    this.unsubs.push(party.subscribe((state) => this.onPartyState(state)));
    party.start();
  }

  private onPartyState(state: PartyState): void {
    for (const id of this.connections) this.pushPartyView(id, state);

    const round = state.round;
    if (state.phase === 'choosing' && round && round.roundId !== this.partyRoundPlanned) {
      this.partyRoundPlanned = round.roundId;
      this.planPartyRound(round.roundId, round.deadlineAt);
    }
    // 人間が全員決めたら AI も決める。待たせても何も起きない
    if (state.phase === 'choosing' && round) {
      const humansReady = state.members
        .filter((m) => m.kind === 'human' && !m.out)
        .every((m) => m.hasPicked);
      const aiPending = state.members.some((m) => m.kind === 'ai' && !m.out && !m.hasPicked);
      if (humansReady && aiPending && this.partyRushRound !== round.roundId) {
        this.partyRushRound = round.roundId;
        this.laterParty(() => {
          const party = this.party;
          if (!party || party.snapshot().round?.roundId !== round.roundId) return;
          for (const [id, choice] of party.aiPicks()) party.pick(id, choice);
        }, 700);
      }
    }

    // 演出の段はサーバーが刻む。全員の画面で同じ間になる。
    // 誰も死んでいない部屋で3.4秒止めると、18部屋ぶんで無駄が積む。
    // 死んだ者がいる部屋だけ尺を使う（悔しさはそこで出る）
    const someoneDied = (state.verdict?.results ?? []).some((r) => !r.survived && r.chosenId !== null);
    if (state.phase === 'hush') this.laterParty(() => this.party?.advancePresentation(), 900);
    if (state.phase === 'reveal') this.laterParty(() => this.party?.advancePresentation(), 1200);
    if (state.phase === 'verdict') {
      this.laterParty(() => this.party?.advancePresentation(), someoneDied ? 3400 : 1400);
    }
  }

  private planPartyRound(roundId: string, deadlineAt: number): void {
    this.clearPartyTimers();
    const party = this.party;
    if (!party) return;

    // AI の助言は時間差で置く。一斉に出ると読めない
    let at = 1200;
    for (const hint of party.aiHints()) {
      at += 900 + Math.random() * 1100;
      this.laterParty(() => party.hint(hint.memberId, hint.text), at);
    }
    // 助言が出そろってから決める
    this.laterParty(() => {
      for (const [id, choice] of party.aiPicks()) party.pick(id, choice);
    }, at + 1500);

    // 締切はサーバーが持つ。決めなかった人は決めなかったものとして扱う
    this.laterParty(() => {
      if (party.snapshot().round?.roundId === roundId) party.timeUp();
    }, Math.max(1000, deadlineAt - this.now()));
  }

  private laterParty(fn: () => void, ms: number): void {
    this.partyTimers.push(setTimeout(fn, ms));
  }

  private clearPartyTimers(): void {
    for (const t of this.partyTimers) clearTimeout(t);
    this.partyTimers = [];
  }

  /** 一人ずつ宛てて送る。**知識が乗るのはここだけ** */
  private pushPartyView(connectionId: string, state: PartyState): void {
    this.sink.send(connectionId, {
      t: 'party/view',
      view: {
        phase: state.phase,
        meId: connectionId,
        members: state.members.map((m) => ({
          id: m.id, name: m.name, kind: m.kind, lives: m.lives, out: m.out, hasPicked: m.hasPicked,
        })),
        round: state.round
          ? {
              roundId: state.round.roundId,
              room: state.round.room,
              roomNumber: state.round.roomNumber,
              sectionIndex: state.round.sectionIndex,
              timeLimitMs: state.round.timeLimitMs,
              deadlineAt: state.round.deadlineAt,
              advice: state.round.advice.map((a) => ({ ...a, record: { ...a.record } })),
              freshCast: state.round.freshCast,
            }
          : null,
        verdict: state.verdict
          ? { ...state.verdict, results: state.verdict.results.map((r) => ({ ...r })) }
          : null,
        sectionIndex: state.sectionIndex,
        sectionCount: state.sectionCount,
        roomsPerSection: state.roomsPerSection,
        roomNumber: state.roomNumber,
        totalRooms: state.totalRooms,
        traitors: [...state.traitors],
        knowledge: this.party?.knowledgeFor(connectionId) ?? null,
        serverNow: this.now(),
      },
    });
  }

  private stop(): void {
    this.clearDeadline();
    this.clearPartyTimers();
    this.party?.dispose();
    this.party = null;
    this.partyRoundPlanned = null;
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
    this.pushView(state);

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

  /**
   * 挑戦者の画面ぶんをまるごと送る。宛先は挑戦者だけ。
   * liarLog は載せない（今の部屋の嘘つきが分かると助言の意味が消える）。
   */
  private pushView(state: EngineState): void {
    const id = this.challengerId;
    if (!id) return;
    const round = state.round;
    this.sink.send(id, {
      t: 'room/view',
      view: {
        phase: state.phase,
        mode: this.modeId,
        lives: state.lives,
        maxLives: state.maxLives,
        sectionIndex: state.sectionIndex,
        sectionCount: state.sectionCount,
        totalCleared: state.totalCleared,
        totalRooms: state.totalRooms,
        advisors: [...state.advisors],
        mutedIds: [...state.mutedIds],
        confirmedLiars: [...state.confirmedLiars],
        canSilence: state.canSilence,
        round: round
          ? {
              roundId: round.roundId,
              room: round.room,
              roomNumber: round.roomNumber,
              sectionIndex: round.sectionIndex,
              timeLimitMs: round.timeLimitMs,
              deadlineAt: round.deadlineAt,
              speakers: [...round.speakers],
              advice: round.advice.map((a) => ({
                advisorId: a.advisorId,
                advisorName: a.advisorName,
                text: a.text,
                sentAt: a.sentAt,
                record: { ...a.record },
              })),
              silenceUsed: round.silenceUsed,
              freshCast: round.freshCast,
              ownCandidates: [...round.ownCandidates],
              restingIds: [...round.restingIds],
            }
          : null,
        verdict: state.verdict
          ? {
              ...state.verdict,
              liars: [...state.verdict.liars],
              party: state.verdict.party.map((p) => ({ ...p })),
            }
          : null,
        serverNow: this.now(),
      },
    });
  }

  private pushState(state?: EngineState): void {
    const s = state ?? this.engine?.snapshot();
    // まだ始まっていない部屋でも名簿は配る。
    // 配らないと待合に「誰が来たか」が出ない
    this.sink.broadcast({
      t: 'room/state',
      phase: s?.phase ?? 'title',
      mode: this.modeId,
      lives: s?.lives ?? 0,
      roomNumber: s?.round?.roomNumber ?? 0,
      sectionIndex: s?.sectionIndex ?? 0,
      sectionCount: s?.sectionCount ?? 1,
      roster: s ? [...s.advisors] : this.humans.roster().map((a) => ({ ...a })),
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
