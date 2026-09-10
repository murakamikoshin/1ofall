/**
 * 賭場を長めに回して、区画の変わり目と死んだ直後に
 * **それぞれの画面が何を出しているか**を書き出す。
 *
 * 一部屋ぶんの検査は揃っているが、繋ぎ目は誰も見ていなかった。
 * 顔ぶれが入れ替わる／記録が白紙に戻る／手を挙げた扱いが切れる、
 * が同時に起きるのは区画の変わり目だけなので、そこを通しで見る。
 *
 *   node tools/soak-live.mjs [出力先]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const HOST = '127.0.0.1:1999';
const OUT = process.argv[2] ?? '/tmp';
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; say(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const pages = [];
for (const name of ['みかん役', 'すず役']) {
  const p = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  pages.push({ name, p });
}

const room = `S${Date.now().toString(36).toUpperCase()}`.slice(0, 6).padEnd(6, 'X');
const ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
const inbox = [];
ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (m) => ws.send(JSON.stringify(m));
await wait(200);

for (const [i, { p }] of pages.entries()) {
  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill(room);
  await p.locator('.field').nth(1).fill(['そうく1', 'そうく2'][i]);
  await p.getByRole('button', { name: '入室' }).click();
  await wait(400);
}

send({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
await wait(1200);

const view = () => inbox.filter((m) => m.t === 'room/view').pop()?.view;
const screen = async (p) => p.evaluate(() => {
  const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
  return {
    role: t('.role-title'),
    note: t('.role-note'),
    floor: [...document.querySelectorAll('.floor-row')].map((e) => (e.textContent ?? '').trim()),
    canWrite: document.querySelectorAll('.compose-row').length > 0,
    canPoint: document.querySelectorAll('.floor-act').length > 0,
    volunteer: t('.locked + .primary') || t('.primary'),
    note2: t('.floor-note'),
  };
});

let sectionsSeen = new Set();
let deaths = 0;
let freshSeen = false;
let volunteerCleared = null;

for (let step = 0; step < 40; step++) {
  const v = view();
  if (!v?.round) { await wait(300); continue; }
  const s = v.sectionIndex;
  const n = v.round.roomNumber;
  const inSection = v.totalCleared - 0;

  // 助言と名指しが出そろうのを待つ
  await wait(2600);
  const v2 = view();
  if (!v2?.round) break;

  const door = v2.round.advice.filter((a) => (a.kind ?? 'door') === 'door');
  const call = v2.round.advice.filter((a) => a.kind === 'call');
  const fresh = v2.round.freshCast;
  if (fresh) freshSeen = true;
  if (!sectionsSeen.has(s)) {
    sectionsSeen.add(s);
    say(`\n──── 区画${s + 1}　${n}部屋目　この区画は${v2.roomsPerSection}部屋 ────`);
    say(`  顔ぶれ: ${v2.round.speakers.map((x) => x.name).join(' ')}`);
    say(`  記録が白紙に戻った: ${fresh ? 'はい' : 'いいえ'}`);
    // 枠外に回った人が手を挙げる。区画の頭で切れているか
    for (const { name, p } of pages) {
      const sc = await screen(p);
      if (!sc.canWrite) {
        const before = sc.volunteer;
        await p.getByRole('button', { name: '立候補する' }).click().catch(() => {});
        await wait(300);
        const after = (await screen(p)).volunteer;
        say(`  ${name}（枠外）立候補: ${before} → ${after}`);
        if (volunteerCleared === null && s > 0) volunteerCleared = before.includes('立候補する');
      }
    }
  }

  say(`\n  ${n}部屋目（区画${s + 1}）扉について${door.length}件　名指し${call.length}件　命${v2.lives}`);
  for (const a of door) say(`    ${a.advisorName}（正${a.record.hit} 嘘${a.record.miss}） ${a.text}`);
  for (const a of call) say(`   ＞${a.advisorName} ${a.text}`);

  // 助言者の画面が同じものを見ているか
  for (const { name, p } of pages) {
    const sc = await screen(p);
    if (sc.canWrite) {
      say(`    〔${name}〕 ${sc.role} / 場に${sc.floor.length}件 / 撃てる:${sc.canPoint} ${sc.note2 ? `「${sc.note2}」` : ''}`);
    } else {
      say(`    〔${name}〕 枠外 / 場に${sc.floor.length}件`);
    }
  }

  // わざと外して死ぬ回を作る（区画の頭へ戻るところを見たい）
  const beforeLives = v2.lives;
  const pick = deaths < 1 && n >= 2
    ? v2.round.room.choices[v2.round.room.choices.length - 1].id
    : bestGuess(v2.round);
  send({ t: 'challenger/choose', choiceId: pick, roundId: v2.round.roundId });
  for (let i = 0; i < 6; i++) { send({ t: 'challenger/advance' }); await wait(220); }
  await wait(400);
  const after = view();
  if (after && after.lives < beforeLives) { deaths++; say(`    → 死んだ（命 ${beforeLives}→${after.lives}）`); }
  if (after?.phase === 'over') { say('\n  ▼ 終わり'); break; }
  if (sectionsSeen.size >= 2 && deaths >= 1 && step > 6) break;
}

/** 素朴に一番名の挙がった扉 */
function bestGuess(round) {
  const tally = new Map(round.room.choices.map((c) => [c.id, 0]));
  for (const a of round.advice) {
    if ((a.kind ?? 'door') !== 'door') continue;
    for (const c of round.room.choices) {
      if (a.text.includes(c.label.ja)) tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
    }
  }
  return [...tally.entries()].sort((x, y) => y[1] - x[1])[0][0];
}

say('');
check('区画をまたげた', sectionsSeen.size >= 2, `${sectionsSeen.size}区画`);
check('死んで区画の頭に戻れた', deaths >= 1, `${deaths}回`);
check('顔ぶれが入れ替わったことが画面に出た', freshSeen);
check('例外なし', errors.length === 0, errors.join(' / '));
if (volunteerCleared !== null) check('手を挙げた扱いが区画の頭で切れている', volunteerCleared === true);

say(`\n${pass} 通過 / ${fail} 失敗`);
writeFileSync(`${OUT}/soak-${Date.now()}.txt`, lines.join('\n'), 'utf8');
ws.close();
await b.close();
process.exit(fail ? 1 : 0);
