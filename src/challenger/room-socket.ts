/** 部屋への線。挑戦者の画面と全員挑戦者の盤面が同じ口を使う */
export function openRoomSocket(host: string, roomCode: string): Promise<WebSocket> {
  const scheme = host.startsWith('localhost') || host.startsWith('127.') ? 'ws' : 'wss';
  const socket = new WebSocket(`${scheme}://${host}/parties/main/${encodeURIComponent(roomCode)}`);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('roomNotFound')));
  });
}
