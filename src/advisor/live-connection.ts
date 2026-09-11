import type { AdvisorConnection, AdvisorView, SectionAnswerView } from './main';
import type { Choice, Knowledge } from '@/core/schema';
import { localized } from '@/i18n';
import { wasTruthful } from '@/core/moderation';

/**
 * 本物の線。PartyKit の部屋に繋いで、自分あての知識だけを受け取る。
 *
 * **zod を読まない。** 助言者ページは電波の悪い場所で開かれる前提なので、
 * 検証ライブラリを初期表示の経路に載せない。
 * 信用できない側（こちら→サーバー）はサーバーが必ず検証するので、
 * ここでは受け取ったものの形だけを見る。
 */

interface Incoming {
  t: string;
  mode?: string;
  myVote?: string;
  hit?: boolean;
  record?: { hit: number; miss: number };
  correct?: string;
  picks?: { advisorId: string; choiceId: string }[];
  roundId?: string;
  room?: { id: string; theme: string; prompt: Record<string, string>; choices: Choice[] };
  knowledge?: Knowledge;
  isSpeaker?: boolean;
  you?: string;
  roomInSection?: number;
  code?: string;
  hints?: { advisorId: string; advisorName: string; text: string; kind?: string }[];
  sectionIndex?: number;
  cleared?: boolean;
  rows?: { id: string; name: string; liar: boolean; hit: number; miss: number }[];
  rank?: { place: number; of: number };
  /** 挑戦者が選んだ扉。round/result で全員に配られる */
  chosen?: string;
}

const RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;

export class LiveConnection implements AdvisorConnection {
  private socket: WebSocket | null = null;
  private viewListeners = new Set<(v: AdvisorView | null) => void>();
  private noticeListeners = new Set<(code: string) => void>();
  private answerListeners = new Set<(a: SectionAnswerView) => void>();
  /** 最新の盤面。あとから購読した画面や、再接続した人が次の部屋まで待たされない */
  private latest: AdvisorView | null = null;
  private roomCode = '';
  private isParty = false;
  private myPick: { roundId: string; choiceId: string } | null = null;
  private myVote: string | null = null;
  /** この部屋でほかの人が言ったこと。届いた順のまま持つ */
  private said: { advisorId: string; advisorName: string; text: string; kind?: string }[] = [];
  private myCall: { targetId: string; doubt: boolean } | null = null;
  /** この部屋で自分の一言をもう出したか。出す前は人を指せない */
  private spoke = false;
  /** 自分のID。場に並ぶ言葉のどれが自分のものかを見分けるため */
  private myId = '';
  /** 一度でも部屋を受け取ったか。次の周を待っているのかを見分けるため */
  private played = false;
  /** 手を挙げたか。区画のあいだ続く（サーバー側と同じ規則） */
  private volunteered = false;
  private voteRecord: { hit: number; miss: number } = { hit: 0, miss: 0 };
  /** 賭けている人の中での順位。届いていなければ null */
  private voteRank: { place: number; of: number } | null = null;
  /**
   * この周で自分の一言がどうなったかの通算。
   *
   * 部屋ごとには返すようにした（18回目）が、**周が終わると何も残らない**。
   * 嘘つきは「何人殺したか」を、正直者は「何度信じられたか」を
   * 持ち帰れないまま次の周へ行っていた。
   */
  private runTally = { followed: 0, ignored: 0, killed: 0, saved: 0 };
  /** 周が終わった印。次の周の一部屋目で通算を白紙に戻す */
  private runEnded = false;
  private name = '';
  private attempt = 0;
  private closed = false;

  constructor(private readonly host: string) {}

  join(roomCode: string, name: string): Promise<void> {
    this.roomCode = roomCode.toUpperCase();
    this.name = name;
    this.closed = false;
    return this.connect();
  }

  onView(listener: (view: AdvisorView | null) => void): () => void {
    this.viewListeners.add(listener);
    listener(this.latest);
    return () => this.viewListeners.delete(listener);
  }

  /** 枠外の賭けの通算。画面に出すため */
  betRecord(): { hit: number; miss: number } {
    return this.voteRecord;
  }

  betRank(): { place: number; of: number } | null {
    return this.voteRank;
  }

  /** この周の通算。周が終わったときに出す */
  runTallyOf(): { followed: number; ignored: number; killed: number; saved: number } {
    return { ...this.runTally };
  }

  /** 部屋がまだ開いていないのか、次の周を待っているのか */
  waitingFor(): 'notOpen' | 'betweenRuns' {
    return this.played ? 'betweenRuns' : 'notOpen';
  }

  onNotice(listener: (code: string) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  onAnswer(listener: (a: SectionAnswerView) => void): () => void {
    this.answerListeners.add(listener);
    return () => this.answerListeners.delete(listener);
  }

  sendHint(roundId: string, text: string): void {
    this.send({ t: 'advisor/hint', roundId, text });
    this.spoke = true;
    this.publish();
  }

  volunteer(roundId: string): void {
    this.send({ t: 'advisor/volunteer', roundId });
    this.volunteered = true;
    this.publish();
  }

  point(roundId: string, targetId: string, doubt: boolean): void {
    this.myCall = { targetId, doubt };
    this.send({ t: 'advisor/point', roundId, targetId, doubt });
    this.publish();
  }

  vote(roundId: string, choiceId: string): void {
    this.myVote = choiceId;
    this.send({ t: 'advisor/vote', roundId, choiceId });
  }

  pick(roundId: string, choiceId: string): void {
    this.myPick = { roundId, choiceId };
    this.send({ t: 'party/pick', roundId, choiceId });
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  /* ───────────────────────────── 内部 ───────────────────────────── */

  private connect(): Promise<void> {
    const scheme = this.host.startsWith('localhost') || this.host.startsWith('127.') ? 'ws' : 'wss';
    const url = `${scheme}://${this.host}/parties/main/${encodeURIComponent(this.roomCode)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const settled = { done: false };
      socket.addEventListener('open', () => {
        this.attempt = 0;
        this.send({ t: 'advisor/join', roomCode: this.roomCode, ...(this.name ? { name: this.name } : {}) });
        if (!settled.done) {
          settled.done = true;
          resolve();
        }
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        this.receive(event.data);
      });
      socket.addEventListener('close', () => {
        if (this.closed) return;
        this.notify('disconnected');
        this.retry();
      });
      socket.addEventListener('error', () => {
        if (!settled.done) {
          settled.done = true;
          reject(new Error('roomNotFound'));
        }
      });
    });
  }

  /** 切れても自分で戻る。電車の中で開かれる画面なので、押し直させない */
  private retry(): void {
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    window.setTimeout(() => {
      if (this.closed) return;
      void this.connect().catch(() => this.retry());
    }, wait);
  }

  private receive(raw: string): void {
    let msg: Incoming;
    try {
      msg = JSON.parse(raw) as Incoming;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'room/state':
        this.isParty = msg.mode === 'party';
        return;
      case 'round/result': {
        // 全員挑戦者モードでは、自分の生死がここで決まる
        if (this.isParty) {
          if (!this.myPick || this.myPick.roundId !== msg.roundId) return;
          this.notify(this.myPick.choiceId === msg.correct ? 'survived' : 'died');
          this.myPick = null;
          return;
        }
        this.reportMyRound(msg);
        return;
      }
      case 'round/open': {
        const room = msg.room;
        if (!room || !msg.roundId) return;
        this.myId = msg.you ?? this.myId;
        this.played = true;
        if (this.runEnded) {
          this.runEnded = false;
          this.runTally = { followed: 0, ignored: 0, killed: 0, saved: 0 };
        }
        // 手を挙げた扱いは区画の頭で切れる（サーバー側と同じ）
        if (msg.roomInSection === 0) this.volunteered = false;
        if (msg.roundId !== this.latest?.roundId) {
          this.myVote = null;
          this.said = [];
          this.myCall = null;
          this.spoke = false;
        }
        this.push({
          roundId: msg.roundId,
          roomId: room.id,
          theme: room.theme,
          prompt: localized(room.prompt as never),
          choices: room.choices,
          // 席には居るが今回は配られていない、ということが起こりうる
          knowledge: msg.knowledge ?? null,
          isSpeaker: msg.isSpeaker === true,
          myId: msg.you ?? this.myId,
          volunteered: this.volunteered,
          isParty: this.isParty,
          myVote: msg.myVote ?? this.myVote,
          said: this.said,
          myCall: this.myCall,
          spoke: this.spoke,
        });
        return;
      }
      case 'round/hints': {
        // ほかの人が言ったことが届く。これが見えないと誰も指せない
        if (!msg.hints || msg.roundId !== this.latest?.roundId) return;
        this.said = msg.hints;
        this.publish();
        return;
      }
      case 'game/over':
        // 周が終わった。次の部屋が来たら通算を白紙に戻す
        this.runEnded = true;
        this.push(null);
        return;
      case 'advisor/voteResult': {
        this.voteRecord = msg.record ?? this.voteRecord;
        this.voteRank = msg.rank ?? this.voteRank;
        this.notify(msg.hit ? 'voteHit' : 'voteMiss');
        return;
      }
      case 'section/answer': {
        // 区画を離れた。誰が嘘つきだったかがここで開く
        if (!msg.rows) return;
        const answer = {
          sectionIndex: msg.sectionIndex ?? 0,
          cleared: msg.cleared === true,
          rows: msg.rows,
        };
        for (const l of this.answerListeners) l(answer);
        return;
      }
      case 'advisor/silenced':
        this.notify('silenced');
        return;
      case 'advisor/muted':
        this.notify('muted');
        return;
      case 'error':
        this.notify(msg.code ?? 'unknown');
        return;
    }
  }

  /**
   * 発言枠にいた人へ、自分の一言がどうなったかを返す。
   *
   * ここまで、**枠にいる人には何も返っていなかった。**
   * 枠外の賭けには当たり外れと通算が返るのに、言葉を書いた5〜8人には
   * 挑戦者が自分を信じたのかも、生きたのかも返らない。
   * 嘘つきは罠が刺さったかを知らないまま次の部屋へ行っていた。
   *
   * 線は増やさない。`round/result` は選んだ扉と正解を全員に配っているので、
   * 自分の一言と突き合わせれば画面の中で出せる。
   */
  private reportMyRound(msg: Incoming): void {
    const view = this.latest;
    const me = this.myId;
    if (!view || !me || !msg.chosen || !msg.correct) return;
    // 扉についての自分の一言。名指し（人を撃った一言）は数えない
    const mine = this.said.filter((h) => h.advisorId === me && (h.kind ?? 'door') === 'door').at(-1);
    if (!mine) return;

    const labels: string[] = view.choices.map((c) => localized(c.label as never));
    const labelOf = (id: string): string =>
      localized((view.choices.find((c) => c.id === id)?.label ?? { ja: '', en: '' }) as never);
    /*
     * 「信じられたか」は「挑戦者が選んだ扉に対して自分の言葉が当たっていたか」。
     * 正解を当たりに置けば正誤の判定になるので、同じ関数を選んだ扉で回す
     * （「Xは死ぬ」と言って挑戦者が X を避けたなら、信じられている）。
     */
    const followed = wasTruthful(mine.text, labelOf(msg.chosen), labels);
    const survived = msg.chosen === msg.correct;
    // 周ぶんに積む。嘘つきの手柄は killed、正直者の手柄は saved
    if (followed) {
      this.runTally.followed += 1;
      if (survived) this.runTally.saved += 1;
      else this.runTally.killed += 1;
    } else {
      this.runTally.ignored += 1;
    }
    this.notify(followed
      ? (survived ? 'followedLived' : 'followedDied')
      : (survived ? 'ignoredLived' : 'ignoredDied'));
  }

  private push(view: AdvisorView | null): void {
    this.latest = view;
    for (const l of this.viewListeners) l(view);
  }

  /** 盤面のうち、こちら側で持っているぶんだけ差し替えて描き直させる */
  private publish(): void {
    if (!this.latest) return;
    this.push({
      ...this.latest,
      said: this.said, myCall: this.myCall, myVote: this.myVote,
      spoke: this.spoke, myId: this.myId, volunteered: this.volunteered,
    });
  }

  private notify(code: string): void {
    for (const l of this.noticeListeners) l(code);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
