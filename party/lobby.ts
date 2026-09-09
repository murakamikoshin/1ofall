import type * as Party from 'partykit/server';
import { LobbyClientMessageSchema, type LobbyServerMessage } from '../src/core/schema';
import { PARTY_MIN_SEATS, ROOM_CODE_LENGTH } from '../src/core/limits';

/**
 * 野良の待合室。**ゲームを知らない。**
 * やるのは「同じモードを待っている人を集めて、合言葉を配る」ことだけ。
 *
 * 人数が揃うのを待つが、待たせすぎない。
 * 30秒で足りないぶんは AI が埋めるので、一人でも始められる。
 */

/** 人間がこれだけ集まったら始める。残りは AI */
const WANT_HUMANS = 3;
const MAX_WAIT_MS = 30_000;
/** 見間違えやすい字（I・O・0・1）を外す */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface Waiting {
  id: string;
  mode: string;
  since: number;
}

export default class LobbyRoom implements Party.Server {
  private waiting = new Map<string, Waiting>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection): void {
    if (typeof message !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      return;
    }
    const parsed = LobbyClientMessageSchema.safeParse(json);
    if (!parsed.success) return;

    if (parsed.data.t === 'lobby/cancel') {
      this.waiting.delete(sender.id);
      this.announce();
      return;
    }

    this.waiting.set(sender.id, { id: sender.id, mode: parsed.data.mode, since: Date.now() });
    this.announce();
    this.tryMatch();
    this.arm();
  }

  onClose(connection: Party.Connection): void {
    this.waiting.delete(connection.id);
    this.announce();
  }

  /** 待っている人が居るあいだは、締切を見張る */
  private arm(): void {
    if (this.timer || this.waiting.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tryMatch(true);
      this.arm();
    }, 5_000);
  }

  private tryMatch(force = false): void {
    const byMode = new Map<string, Waiting[]>();
    for (const w of this.waiting.values()) {
      const list = byMode.get(w.mode) ?? [];
      list.push(w);
      byMode.set(w.mode, list);
    }

    for (const [, list] of byMode) {
      list.sort((a, b) => a.since - b.since);
      const oldest = list[0];
      const waited = oldest ? Date.now() - oldest.since : 0;
      const enough = list.length >= WANT_HUMANS;
      const timedOut = force && waited >= MAX_WAIT_MS && list.length >= 1;
      if (!enough && !timedOut) continue;

      const group = list.slice(0, PARTY_MIN_SEATS);
      const roomCode = this.newCode();
      group.forEach((w, i) => {
        this.waiting.delete(w.id);
        this.tell(w.id, { t: 'lobby/found', roomCode, host: i === 0 });
      });
    }
    this.announce();
  }

  private announce(): void {
    const now = Date.now();
    for (const w of this.waiting.values()) {
      const sameMode = [...this.waiting.values()].filter((o) => o.mode === w.mode).length;
      this.tell(w.id, {
        t: 'lobby/waiting',
        waiting: sameMode,
        need: WANT_HUMANS,
        startsBy: w.since + MAX_WAIT_MS,
        serverNow: now,
      });
    }
  }

  private tell(connectionId: string, message: LobbyServerMessage): void {
    this.room.getConnection(connectionId)?.send(JSON.stringify(message));
  }

  private newCode(): string {
    let out = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }
}
