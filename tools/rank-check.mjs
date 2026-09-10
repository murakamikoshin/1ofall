/**
 * 枠外の賭けの順位が本人に返るか。
 *
 * 配信で1000人が見ていると、発言できるのは8人。残りに渡してある手は
 * 一票だけで、返していたのは当たり外れの通算だけだった。
 * 「当4 外1」では自分が上手いのか下手なのか分からないので、
 * 賭けている人の中での順位を返す。
 *
 * 見るのは三つ。
 *   1. 二人以上が賭けていれば順位が届く
 *   2. 当てた人のほうが上位に来る
 *   3. 分母は**賭けた人だけ**（見ているだけの人を入れると意味が消える）
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `rank-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/room-session';
    export * from './src/core/limits';
    export { setLocale, localized } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const sent = [];
const sink = {
  send: (id, msg) => sent.push({ id, msg }),
  broadcast: (msg) => sent.push({ id: '*', msg }),
  close: () => {},
};
// 崖っぷちは発言枠が4なので、入れた人が枠外に回りやすい
const session = new C.RoomSession({ pack, sink, seed: 2024, aiCount: 12 });
session.connect('ch');
const say = (id, m) => session.receive(id, JSON.stringify(m));
const WATCHERS = ['w1', 'w2', 'w3', 'w4'];
for (const w of WATCHERS) {
  session.connect(w);
  say(w, { t: 'advisor/join', name: w.toUpperCase() });
}
say('ch', { t: 'challenger/start', mode: 'brink', locale: 'ja' });
await wait(400);

const views = () => sent.filter((s) => s.msg.t === 'room/view').map((s) => s.msg.view);
const results = () => sent.filter((s) => s.msg.t === 'advisor/voteResult');

let rooms = 0;
for (let r = 0; r < 12; r++) {
  const v = views().at(-1);
  if (!v || !v.round) break;
  if (v.phase === 'gameover' || v.phase === 'cleared') break;
  const round = v.round;
  const speakers = new Set(round.speakers.map((s) => s.id));
  const correct = null; // 挑戦者にも正解は見えない。当たりは判定で分かる
  void correct;
  // 枠外に回っている人だけが賭けられる
  const outside = WATCHERS.filter((w) => !speakers.has(w));
  if (outside.length >= 2) {
    rooms++;
    // 一人目はいつも先頭の扉、二人目はいつも最後の扉。片方は当たりやすい
    outside.forEach((w, i) => {
      const choice = round.room.choices[i % round.room.choices.length];
      say(w, { t: 'advisor/vote', roundId: round.roundId, choiceId: choice.id });
    });
  }
  await wait(120);
  const now = views().at(-1);
  if (!now?.round) break;
  say('ch', { t: 'challenger/choose', choiceId: now.round.room.choices[0].id, roundId: now.round.roundId });
  for (let i = 0; i < 4; i++) { say('ch', { t: 'challenger/advance' }); await wait(30); }
  await wait(60);
}

console.log(`\n枠外で賭けられた部屋 ${rooms}　返した結果 ${results().length}件`);
check('賭けた人に結果が返る', results().length > 0, `${results().length}件`);
const withRank = results().filter((s) => s.msg.rank);
check('順位が乗っている', withRank.length > 0, `${withRank.length}/${results().length}`);
const shaped = withRank.every((s) => s.msg.rank.place >= 1 && s.msg.rank.place <= s.msg.rank.of);
check('順位が分母の中に収まっている', shaped,
  JSON.stringify(withRank.map((s) => s.msg.rank).slice(0, 4)));
// 分母は賭けた人だけ。AI も含めた12人が入っていたら多すぎる
const maxOf = Math.max(0, ...withRank.map((s) => s.msg.rank.of));
check('分母は賭けた人だけ', maxOf <= WATCHERS.length, `分母 ${maxOf} / 賭けた人 ${WATCHERS.length}`);
// 当てた人が上位に来ているか（最後の結果で見る）
const last = new Map();
for (const s of withRank) last.set(s.id, s.msg);
const rows = [...last.entries()].map(([id, m]) => ({ id, hit: m.record.hit, place: m.rank.place }));
rows.sort((a, b) => a.place - b.place);
console.log(rows.map((x) => `${x.id} 当${x.hit} → ${x.place}位`).join(' / '));
const ordered = rows.every((x, i) => i === 0 || rows[i - 1].hit >= x.hit);
check('当てた人が上に来る', ordered, JSON.stringify(rows));

session.disconnect('ch');
console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
