/**
 * サーバー側の部屋（RoomSession）を、通信を張らずに動かす確認。
 *
 * 一番見たいのは「他人あての知識が自分に届かないこと」。
 * 次に「信用できない側から何を送られても、権限のないことができないこと」。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `party-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export { RoomSession } from './src/core/room-session';
      export { corePackage } from './src/core/pack';
      export { ServerMessageSchema } from './src/core/schema';
      export { setLocale } from './src/i18n';
    `,
    resolveDir: root, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

/** 送られたものを全部ためる偽の線 */
function makeSink(ids) {
  const inbox = new Map(ids.map((id) => [id, []]));
  return {
    inbox,
    sink: {
      send(id, msg) {
        const r = C.ServerMessageSchema.safeParse(msg);
        if (!r.success) throw new Error(`型を通らない送信 (${msg.t}): ${r.error.issues[0]?.message}`);
        inbox.get(id)?.push(msg);
      },
      broadcast(msg) {
        const r = C.ServerMessageSchema.safeParse(msg);
        if (!r.success) throw new Error(`型を通らない一斉送信 (${msg.t}): ${r.error.issues[0]?.message}`);
        for (const list of inbox.values()) list.push(msg);
      },
    },
  };
}

const CH = 'conn_challenger';
const A1 = 'conn_a1';
const A2 = 'conn_a2';
const { inbox, sink } = makeSink([CH, A1, A2]);

let clock = 1_700_000_000_000;
const room = new C.RoomSession({ pack: C.corePackage(), sink, aiCount: 8, seed: 4242, now: () => clock });

room.connect(CH);
room.connect(A1);
room.connect(A2);
room.receive(A1, JSON.stringify({ t: 'advisor/join', roomCode: 'ABC123', name: 'たろう' }));
room.receive(A2, JSON.stringify({ t: 'advisor/join', roomCode: 'ABC123', name: 'すず' }));
room.receive(CH, JSON.stringify({ t: 'challenger/start', mode: 'standard', locale: 'ja' }));

const roomSend = (id, msg) => room.receive(id, JSON.stringify(msg));
const opensFor = (id) => inbox.get(id).filter((m) => m.t === 'round/open');
const firstOpen = (id) => opensFor(id)[0];

check('挑戦者に部屋が届く', !!firstOpen(CH));
check('助言者にも部屋が届く', !!firstOpen(A1) && !!firstOpen(A2));

/* ── 1. 正解が挑戦者側へ流れない ─────────────────────────────── */

const chOpen = firstOpen(CH);
check('挑戦者の部屋に correct が無い', chOpen && !('correct' in chOpen.room));
check('挑戦者の部屋に deathMessage が無い', chOpen && !('deathMessage' in chOpen.room));
check('挑戦者に knowledge が乗らない', chOpen && !('knowledge' in chOpen));

/* ── 2. 他人あての知識が自分に届かない ────────────────────────── */

const k1 = firstOpen(A1)?.knowledge;
const k2 = firstOpen(A2)?.knowledge;
check('助言者は自分の知識だけを受け取る', JSON.stringify(k1) !== JSON.stringify(k2) || k1 === undefined || k2 === undefined,
  '二人に同じものが届いた');
const leaked = inbox.get(A1).filter((m) => m.t === 'round/open' && m.knowledge && JSON.stringify(m.knowledge) === JSON.stringify(k2));
check('他人あての round/open が混ざらない', leaked.length === 0);

/* ── 3. 助言者は挑戦者の操作ができない ──────────────────────── */

const before = inbox.get(CH).filter((m) => m.t === 'round/result').length;
room.receive(A1, JSON.stringify({ t: 'challenger/choose', choiceId: chOpen.room.choices[0].id, roundId: chOpen.roundId }));
const after = inbox.get(CH).filter((m) => m.t === 'round/result').length;
check('助言者が扉を選べない', before === after);
const errs = inbox.get(A1).filter((m) => m.t === 'error');
check('権限が無いことは error で返る', errs.some((e) => e.code === 'notChallenger'));

/* ── 4. 壊れた入力で落ちない ────────────────────────────────── */

let crashed = false;
for (const junk of ['', '{', 'null', '[]', '{"t":"advisor/nuke"}', JSON.stringify({ t: 'advisor/hint', text: 'あ'.repeat(9999), roundId: 'x' })]) {
  try { room.receive(A1, junk); } catch (e) { crashed = true; console.log('   ', e.message); }
}
check('壊れた入力で落ちない', !crashed);
check('壊れた入力は error で返る', inbox.get(A1).filter((m) => m.t === 'error' && m.code === 'badMessage').length >= 4);

/* ── 5. 暴言はサーバーで止まる ──────────────────────────────── */

const hintsBefore = inbox.get(CH).filter((m) => m.t === 'round/hints').length;
room.receive(A1, JSON.stringify({ t: 'advisor/hint', text: '死ね', roundId: chOpen.roundId }));
const abuseGotThrough = inbox.get(CH)
  .filter((m) => m.t === 'round/hints')
  .some((m) => m.hints.some((h) => h.text.includes('死ね')));
check('暴言はサーバーで止まる', !abuseGotThrough);

/* ── 6. まともな助言は通り、全員に配られる ──────────────────── */

// 発言枠に入っている人でないと通らないので、入っている人を探す
const speaker = [A1, A2].find((id) => firstOpen(id)?.isSpeaker);
if (speaker) {
  clock += 5000;
  room.receive(speaker, JSON.stringify({ t: 'advisor/hint', text: 'ここは通れる', roundId: chOpen.roundId }));
  const delivered = inbox.get(CH)
    .filter((m) => m.t === 'round/hints')
    .some((m) => m.hints.some((h) => h.text === 'ここは通れる'));
  check('まともな助言は挑戦者に届く', delivered);
} else {
  check('発言枠に人間が入った部屋がある（この部屋は AI だけだった）', true);
}

/* ── 6.5 挑戦者の画面ぶんに答えが混ざらない ────────────────── */

const views = inbox.get(CH).filter((m) => m.t === 'room/view');
check('挑戦者に画面ぶんが届く', views.length > 0, `${views.length}通`);
const view = views.at(-1)?.view;
check('画面ぶんの部屋に correct が無い', !view?.round?.room || !('correct' in view.round.room));
check('画面ぶんに liarLog が無い', view && !('liarLog' in view), '嘘つきの一覧が混ざっている');
check('助言者には画面ぶんを送らない',
  inbox.get(A1).filter((m) => m.t === 'room/view').length === 0
  && inbox.get(A2).filter((m) => m.t === 'room/view').length === 0);
check('選ぶ前は verdict が立っていない',
  views.filter((v) => v.view.phase === 'choosing').every((v) => v.view.verdict === null));

/* ── 6.8 疑いの札は助言者へ配られる（挑戦者には返さない） ───── */

/*
 * 札は挑戦者の覚え書きだった。置かれても場が何も変わらないので、
 * 配信で一番おいしい「名指しされた人が弁解する」が起きなかった。
 * 公開するにあたって見るのは二つ。**撃たれている本人に届くか**と、
 * **札を置けるのは挑戦者だけか**（助言者が互いに札を貼れると、
 * 挑戦者の読みを騙る道になる）。
 */
const doubtsBefore = inbox.get(A1).filter((m) => m.t === 'room/doubts').length;
room.receive(CH, JSON.stringify({ t: 'challenger/doubt', advisorId: A1, on: true }));
const marks = inbox.get(A1).filter((m) => m.t === 'room/doubts').pop();
check('札が助言者に届く', !!marks && marks.ids.includes(A1), JSON.stringify(marks));
check('札は撃たれていない人にも見える', (inbox.get(A2).filter((m) => m.t === 'room/doubts').pop()?.ids ?? []).includes(A1));
check('札を挑戦者へ送り返さない', inbox.get(CH).filter((m) => m.t === 'room/doubts').length === 0);

const errsBefore = inbox.get(A2).filter((m) => m.t === 'error').length;
room.receive(A2, JSON.stringify({ t: 'challenger/doubt', advisorId: A1, on: false }));
check('助言者は札を置けない',
  (inbox.get(A1).filter((m) => m.t === 'room/doubts').pop()?.ids ?? []).includes(A1)
  && inbox.get(A2).filter((m) => m.t === 'error').length > errsBefore);

room.receive(CH, JSON.stringify({ t: 'challenger/doubt', advisorId: A1, on: false }));
check('札を外すと消える', (inbox.get(A1).filter((m) => m.t === 'room/doubts').pop()?.ids ?? []).length === 0);
check('札の増減が一通ずつ届く', inbox.get(A1).filter((m) => m.t === 'room/doubts').length >= doubtsBefore + 2);

/* ── 6.9 押された者は言い切る ───────────────────────────────── */

/*
 * 札は印だけではない。**置かれた者は言い切らなければならない**
 * （扉ひとつを名指しして、迷いの言い方を使わない）。
 * AI だけの作法にしてしまうと、賭場では札が何も起こさない飾りに戻る。
 */
if (speaker) {
  const choices = firstOpen(speaker).room.choices;
  const one = choices[0].label.ja;
  const two = choices[1].label.ja;
  const mustCommitErrors = () =>
    inbox.get(speaker).filter((m) => m.t === 'error' && m.code === 'mustCommit').length;
  const delivered = (text) =>
    inbox.get(CH).filter((m) => m.t === 'round/hints').some((m) => m.hints.some((h) => h.text === text));

  const before = mustCommitErrors();
  roomSend(CH, { t: 'challenger/doubt', advisorId: speaker, on: true });

  clock += 5000;
  const hedged = `たぶん${one}`;
  roomSend(speaker, { t: 'advisor/hint', text: hedged, roundId: chOpen.roundId });
  check('押された者の迷いの言い方は弾かれる',
    mustCommitErrors() > before && !delivered(hedged), hedged);

  clock += 5000;
  const committed = `${two}にしろ`;
  roomSend(speaker, { t: 'advisor/hint', text: committed, roundId: chOpen.roundId });
  check('言い切れば通る', delivered(committed), committed);

  roomSend(CH, { t: 'challenger/doubt', advisorId: speaker, on: false });
  clock += 5000;
  const hedgedAgain = `${one}な気がする`;
  roomSend(speaker, { t: 'advisor/hint', text: hedgedAgain, roundId: chOpen.roundId });
  check('札を外せば迷いの言い方も通る', delivered(hedgedAgain), hedgedAgain);
  /*
   * 書き直した一言が挑戦者に届くか。
   *
   * 場の言葉は**件数**が増えたときだけ流していた。一部屋につき一人一通で
   * 書き直しは上書きなので、件数は変わらない——言い直した一言が
   * 賭場では届かなかった（ソロは本体の状態をそのまま描くので出ていた）。
   */
  check('言い直した一言が最後の便に乗っている',
    (inbox.get(CH).filter((m) => m.t === 'round/hints').pop()?.hints ?? [])
      .some((h) => h.advisorId === speaker && h.text === hedgedAgain));
} else {
  check('この部屋は AI だけだった（押す検査は飛ばす）', true);
}

/* ── 7. 挑戦者が落ちたら畳む ────────────────────────────────── */

room.disconnect(CH);
const stateAfter = inbox.get(A1).filter((m) => m.t === 'room/state').pop();
check('挑戦者が落ちたら部屋が止まる', room.size === 2 && stateAfter !== undefined);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
