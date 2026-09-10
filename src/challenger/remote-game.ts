import type { EngineState } from '@/core/engine';
import type { ChallengerView } from '@/core/schema';
import type { ModeId } from '@/core/limits';

/**
 * 賭場（人間の助言者がいる部屋）で使う、遠くのゲーム。
 *
 * 進行はサーバーが持っている。ここは画面ぶんを受け取って、
 * ローカルの GameEngine と同じ顔をして返すだけ。
 * そうしておくと描画側が「どちらで動いているか」を知らずに済む。
 */

export interface GameHandle {
  subscribe(listener: (state: EngineState) => void): () => void;
  snapshot(): EngineState;
  choose(choiceId: string): void;
  timeUp(): void;
  advancePresentation(): void;
  silence(advisorId: string): { hit: boolean } | null;
  report(reporterId: string, targetId: string, text: string): unknown;
  pause(): void;
  resume(): void;
  dispose(): void;
  /** 手引きを開いても時間が止まるか。遠くの部屋では止まらない */
  readonly canPause: boolean;
}

const EMPTY: EngineState = {
  phase: 'title', lives: 0, maxLives: 0, round: null, verdict: null,
  sectionIndex: 0, sectionCount: 1, clearedInSection: 0, roomsPerSection: 1,
  totalCleared: 0, totalRooms: 0, selectionMode: 'lottery',
  advisors: [], mutedIds: [], confirmedLiars: [], liarLog: [],
};

export type RoomStatus = 'connecting' | 'open' | 'playing' | 'closed';

export class RemoteGame implements GameHandle {
  readonly canPause = false;

  private socket: WebSocket | null = null;
  private listeners = new Set<(state: EngineState) => void>();
  private statusListeners = new Set<(status: RoomStatus, roster: EngineState['advisors']) => void>();
  private state: EngineState = EMPTY;
  private status: RoomStatus = 'connecting';
  private roster: EngineState['advisors'] = [];
  /** サーバーとの時計のずれ。締切の表示をこれで直す */
  private skewMs = 0;
  private closed = false;

  constructor(socket: WebSocket, private readonly locale: string) {
    this.socket = socket;
    this.setStatus('open');
    socket.addEventListener('message', (e) => {
      if (typeof e.data === 'string') this.receive(e.data);
    });
    socket.addEventListener('close', () => {
      if (!this.closed) this.setStatus('closed');
    });
  }

  /** 全員挑戦者に切り替えるとき、線はそのまま渡す */
  takeSocket(): WebSocket | null {
    return this.socket;
  }

  /** 助言者が集まるまでの待合。集まったら start() で始める */
  onStatus(listener: (status: RoomStatus, roster: EngineState['advisors']) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.roster);
    return () => this.statusListeners.delete(listener);
  }

  start(mode: ModeId): void {
    this.send({ t: 'challenger/start', mode, locale: this.locale });
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  snapshot(): EngineState {
    return this.state;
  }

  choose(choiceId: string): void {
    const roundId = this.state.round?.roundId;
    if (!roundId) return;
    this.send({ t: 'challenger/choose', choiceId, roundId });
  }

  /** 締切はサーバーが持っている。こちらから告げることはない */
  timeUp(): void {}

  advancePresentation(): void {
    this.send({ t: 'challenger/advance' });
  }

  silence(advisorId: string): { hit: boolean } | null {
    const roundId = this.state.round?.roundId;
    if (!roundId) return null;
    this.send({ t: 'challenger/silence', advisorId, roundId });
    // 当たりかどうかはサーバーが決める。届いた画面ぶんに出る
    return null;
  }

  report(_reporterId: string, targetId: string, text: string): unknown {
    const roundId = this.state.round?.roundId ?? '';
    this.send({ t: 'challenger/report', advisorId: targetId, roundId, text });
    return { accepted: true, count: 0 };
  }

  pause(): void {}
  resume(): void {}

  dispose(): void {
    this.closed = true;
    this.listeners.clear();
    this.statusListeners.clear();
    this.socket?.close();
    this.socket = null;
  }

  /* ───────────────────────────── 内部 ───────────────────────────── */

  private receive(raw: string): void {
    let msg: { t?: string; view?: ChallengerView; roster?: EngineState['advisors'] };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.t === 'room/state' && msg.roster) {
      this.roster = msg.roster;
      this.setStatus(this.status === 'connecting' ? 'open' : this.status);
      return;
    }
    if (msg.t !== 'room/view' || !msg.view) return;

    const view = msg.view;
    this.skewMs = view.serverNow - Date.now();
    this.state = {
      phase: view.phase as EngineState['phase'],
      lives: view.lives,
      maxLives: view.maxLives,
      sectionIndex: view.sectionIndex,
      sectionCount: view.sectionCount,
      clearedInSection: view.totalCleared % Math.max(1, view.totalRooms / view.sectionCount),
      roomsPerSection: Math.round(view.totalRooms / Math.max(1, view.sectionCount)),
      totalCleared: view.totalCleared,
      totalRooms: view.totalRooms,
      selectionMode: 'lottery',
      advisors: view.advisors,
      mutedIds: view.mutedIds,
      confirmedLiars: view.confirmedLiars,
      // 今の部屋の嘘つきはサーバーが送ってこない。終わったときだけ分かる
      liarLog: [],
      round: view.round
        ? {
            ...view.round,
            index: view.totalCleared,
            freshCast: view.round.freshCast,
            deadlineAt: view.round.deadlineAt - this.skewMs,
          }
        : null,
      verdict: view.verdict,
    };
    if (view.phase !== 'title') this.setStatus('playing');
    for (const l of this.listeners) l(this.state);
  }

  private setStatus(status: RoomStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status, this.roster);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
