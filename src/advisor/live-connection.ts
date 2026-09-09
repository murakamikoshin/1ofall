import type { AdvisorConnection, AdvisorView } from './main';
import type { Choice, Knowledge } from '@/core/schema';
import { localized } from '@/i18n';

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
  roundId?: string;
  room?: { id: string; theme: string; prompt: Record<string, string>; choices: Choice[] };
  knowledge?: Knowledge;
  isSpeaker?: boolean;
  code?: string;
}

const RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;

export class LiveConnection implements AdvisorConnection {
  private socket: WebSocket | null = null;
  private viewListeners = new Set<(v: AdvisorView | null) => void>();
  private noticeListeners = new Set<(code: string) => void>();
  /** 最新の盤面。あとから購読した画面や、再接続した人が次の部屋まで待たされない */
  private latest: AdvisorView | null = null;
  private roomCode = '';
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

  onNotice(listener: (code: string) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  sendHint(roundId: string, text: string): void {
    this.send({ t: 'advisor/hint', roundId, text });
  }

  volunteer(roundId: string): void {
    this.send({ t: 'advisor/volunteer', roundId });
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
      case 'round/open': {
        const room = msg.room;
        if (!room || !msg.roundId) return;
        this.push({
          roundId: msg.roundId,
          roomId: room.id,
          theme: room.theme,
          prompt: localized(room.prompt as never),
          choices: room.choices,
          // 席には居るが今回は配られていない、ということが起こりうる
          knowledge: msg.knowledge ?? null,
          isSpeaker: msg.isSpeaker === true,
        });
        return;
      }
      case 'game/over':
        this.push(null);
        return;
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

  private push(view: AdvisorView | null): void {
    this.latest = view;
    for (const l of this.viewListeners) l(view);
  }

  private notify(code: string): void {
    for (const l of this.noticeListeners) l(code);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }
}
