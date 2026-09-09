import type * as Party from 'partykit/server';
import { RoomSession } from '../src/core/room-session';
import { corePackage } from '../src/core/pack';

/**
 * PartyKit の部屋。**ここは薄い接ぎ手**。
 * 進行そのものは src/core/room-session.ts が持っていて、
 * そちらは WebSocket を知らないので繋がずに試験できる。
 *
 * 眠らせない（hibernate しない）。
 * 進行中の盤面と配役をメモリに持っているので、
 * 眠って起きたら別の部屋になってしまう。
 */
export default class IssunSakiRoom implements Party.Server {
  private session: RoomSession;

  constructor(readonly room: Party.Room) {
    this.session = new RoomSession({
      pack: corePackage(),
      sink: {
        send: (connectionId, message) => {
          this.room.getConnection(connectionId)?.send(JSON.stringify(message));
        },
        broadcast: (message) => {
          this.room.broadcast(JSON.stringify(message));
        },
      },
    });
  }

  onConnect(connection: Party.Connection): void {
    this.session.connect(connection.id);
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection): void {
    if (typeof message !== 'string') return;
    this.session.receive(sender.id, message);
  }

  onClose(connection: Party.Connection): void {
    this.session.disconnect(connection.id);
  }

  onError(connection: Party.Connection): void {
    this.session.disconnect(connection.id);
  }
}
