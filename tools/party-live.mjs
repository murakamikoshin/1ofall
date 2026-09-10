/** 実際に WebSocket を張って、サーバーの部屋が通しで動くかを見る */
const HOST = process.env.PARTY_HOST ?? '127.0.0.1:1999';
let ROOM = `t${Date.now().toString(36)}`;
const url = (id) => `ws://${HOST}/parties/main/${ROOM}?_pk=${id}`;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`); };

function open(id) {
  const ws = new WebSocket(url(id));
  const inbox = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)) }));
    ws.addEventListener('error', rej);
    setTimeout(() => rej(new Error(`${id} が繋がらない`)), 5000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const openOf = (c) => c.inbox.find((m) => m.t === 'round/open');

/**
 * 部屋を一つ立てて、人間が発言枠に入るまでやり直す。
 * 発言枠は12人中8人なので、二人とも外れることが1割ほどある。
 * そこで検査を飛ばすと、一番見たいところ（人間の助言が届くか）が抜ける。
 */
async function openRoom() {
  for (let attempt = 0; attempt < 6; attempt++) {
    ROOM = `t${Date.now().toString(36)}${attempt}`;
    const ch = await open('challenger');
    await wait(150);
    const a1 = await open('advisor1');
    const a2 = await open('advisor2');
    await wait(200);
    a1.send({ t: 'advisor/join', roomCode: 'ABC123', name: 'たろう' });
    a2.send({ t: 'advisor/join', roomCode: 'ABC123', name: 'すず' });
    await wait(200);
    ch.send({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
    await wait(700);
    const speaker = [a1, a2].find((c) => openOf(c)?.isSpeaker);
    if (speaker) return { ch, a1, a2, speaker, attempt };
    for (const c of [ch, a1, a2]) c.ws.close();
    await wait(150);
  }
  throw new Error('人間が6回とも発言枠に入らなかった');
}

const { ch, a1, a2, speaker, attempt } = await openRoom();
if (attempt > 0) console.log(`   （${attempt + 1}部屋目で人間が発言枠に入った）`);
check('挑戦者に部屋が届いた', !!openOf(ch));
check('助言者にも部屋が届いた', !!openOf(a1) && !!openOf(a2));
check('挑戦者に正解が乗っていない', openOf(ch) && !('correct' in openOf(ch).room) && !('knowledge' in openOf(ch)));
check('助言者には自分の知識が乗る', !!openOf(a1)?.knowledge, JSON.stringify(openOf(a1)));
// 二人に同じ知識が配られること自体はある（嘘つき同士は中身まで同じ）ので、
// 「違うこと」ではなく「自分あての1通しか来ないこと」を見る
const openCount = (c) => c.inbox.filter((m) => m.t === 'round/open').length;
check('自分あての round/open が1通だけ届く',
  openCount(a1) === 1 && openCount(a2) === 1 && openCount(ch) === 1,
  `挑戦者${openCount(ch)} / a1 ${openCount(a1)} / a2 ${openCount(a2)}`);

const roster = ch.inbox.filter((m) => m.t === 'room/state').pop()?.roster ?? [];
check('名簿に人間が入っている', roster.some((a) => a.name === 'たろう') && roster.some((a) => a.name === 'すず'), JSON.stringify(roster.map(r=>r.name)));
check('足りないぶんは AI で埋まる', roster.filter((a) => a.kind === 'ai').length > 0, `${roster.length}人`);

// 暴言はサーバーで止まる
speaker.send({ t: 'advisor/hint', text: '死ね', roundId: openOf(speaker).roundId });
await wait(300);
const abuse = ch.inbox.filter((m) => m.t === 'round/hints').some((m) => m.hints.some((h) => h.text.includes('死ね')));
check('暴言はサーバーで止まる', !abuse);
check('弾いたことは本人に返る', speaker.inbox.some((m) => m.t === 'error'), JSON.stringify(speaker.inbox.filter(m=>m.t==='error')));

// まともな助言は全員に届く
await wait(2600);
speaker.send({ t: 'advisor/hint', text: '結び目は嘘だ', roundId: openOf(speaker).roundId });
await wait(400);
const got = ch.inbox.filter((m) => m.t === 'round/hints').some((m) => m.hints.some((h) => h.advisorName === (speaker === a1 ? 'たろう' : 'すず')));
check('人間の助言が挑戦者に届く', got, JSON.stringify(ch.inbox.filter(m=>m.t==='round/hints').pop()));

// 助言者は扉を選べない
a1.send({ t: 'challenger/choose', choiceId: openOf(ch).room.choices[0].id, roundId: openOf(ch).roundId });
await wait(300);
check('助言者は扉を選べない', a1.inbox.some((m) => m.t === 'error' && m.code === 'notChallenger'));

// 挑戦者が選ぶと結果が全員に流れる
ch.send({ t: 'challenger/choose', choiceId: openOf(ch).room.choices[0].id, roundId: openOf(ch).roundId });
await wait(200);
// 演出の段は挑戦者の画面が進める
// 段は hush→reveal→verdict→（区画の答え合わせ）→次。境目に当たると一段増える
for (let i = 0; i < 4; i++) { ch.send({ t: 'challenger/advance' }); await wait(120); }
check('結果が全員に流れる', a1.inbox.some((m) => m.t === 'round/result') && ch.inbox.some((m) => m.t === 'round/result'));

for (const c of [ch, a1, a2]) c.ws.close();
console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
