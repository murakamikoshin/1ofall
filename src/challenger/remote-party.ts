import type { PartyState } from '@/core/party-engine';
import type { Knowledge, PartyView } from '@/core/schema';
import type { PartySource } from './party-board';

/**
 * 遠くの部屋で動く全員挑戦者モード。
 *
 * 段を刻むのはサーバー（全員の画面で同じ間にするため）。
 * こちらは届いた画面ぶんをそのまま返すだけ。
 */

const EMPTY: PartyState = {
  phase: 'title', members: [], round: null, verdict: null,
  sectionIndex: 0, sectionCount: 1, roomsPerSection: 1, roomNumber: 0, totalRooms: 0,
  traitors: [], traitorsBySection: [], sectionAnswer: null,
};

export class RemotePartySource implements PartySource {
  readonly drivesPresentation = false;

  private state: PartyState = EMPTY;
  private knowledge: Knowledge | null = null;
  private listeners = new Set<(state: PartyState) => void>();
  private me = '';
  /** サーバーとの時計のずれ。締切の表示をこれで直す */
  private skewMs = 0;

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (e) => {
      if (typeof e.data === 'string') this.receive(e.data);
    });
  }

  get meId(): string {
    return this.me;
  }

  subscribe(listener: (state: PartyState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  snapshot(): PartyState {
    return this.state;
  }

  knowledgeForMe(): Knowledge | null {
    return this.knowledge;
  }

  hint(text: string): void {
    this.send({ t: 'advisor/hint', roundId: this.state.round?.roundId ?? '', text });
  }

  report(memberId: string, text: string): void {
    this.send({ t: 'advisor/report', targetId: memberId, roundId: this.state.round?.roundId ?? '', text });
  }

  pick(choiceId: string): void {
    this.send({ t: 'party/pick', roundId: this.state.round?.roundId ?? '', choiceId });
  }

  doubt(memberId: string, on: boolean): void {
    this.send({ t: 'party/doubt', targetId: memberId, on });
  }

  /** 締切もサーバーが持っている。こちらから告げることはない */
  timeUp(): void {}

  /** 段を刻むのもサーバー */
  advance(): void {}

  dispose(): void {
    this.listeners.clear();
    this.socket.close();
  }

  private receive(raw: string): void {
    let msg: { t?: string; view?: PartyView };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.t !== 'party/view' || !msg.view) return;
    const view = msg.view;
    this.me = view.meId;
    this.knowledge = view.knowledge;
    this.skewMs = view.serverNow - Date.now();
    this.state = {
      phase: view.phase as PartyState['phase'],
      members: view.members,
      round: view.round
        ? { ...view.round, freshCast: view.round.freshCast, deadlineAt: view.round.deadlineAt - this.skewMs }
        : null,
      verdict: view.verdict,
      sectionIndex: view.sectionIndex,
      sectionCount: view.sectionCount,
      roomsPerSection: view.roomsPerSection,
      roomNumber: view.roomNumber,
      totalRooms: view.totalRooms,
      traitors: view.traitors,
      traitorsBySection: view.traitorsBySection,
      // 時刻はサーバーのもの。ずれを引いて自分の時計に直す
      sectionAnswer: view.sectionAnswer
        ? { ...view.sectionAnswer, untilMs: view.sectionAnswer.untilMs - this.skewMs }
        : null,
      // 押されている者（二人以上から疑いの札が付いた者）。落とすと札が飾りに戻る
      pressedIds: view.pressedIds ?? [],
    };
    for (const l of this.listeners) l(this.state);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
