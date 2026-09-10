/**
 * 一周終わったあと、**同じ部屋のまま次の周へ入れるか**を見る。
 *
 * ここまで賭場は一周ごとに合言葉が変わっていた。終わりの画面から題名へ戻り、
 * 賭場を開き直すと新しい6文字が振られるので、見ていた全員が入れ直す必要があった。
 * 1周12分の遊びでそれを毎周やらせると、周が進むほど場が減る。
 *
 *   node tools/again-live.mjs [出力先]
 */
import { chromium } from 'playwright';

const HOST = '127.0.0.1:1999';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const room = `A${Date.now().toString(36).toUpperCase()}`.slice(0, 6).padEnd(6, 'X');
const ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
const inbox = [];
ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (m) => ws.send(JSON.stringify(m));
await wait(200);

// 助言者が一人、本物のブラウザで入る
await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
await p.locator('.field').first().fill(room);
await p.locator('.field').nth(1).fill('のこる');
await p.getByRole('button', { name: '入室' }).click();
await wait(500);

const view = () => inbox.filter((m) => m.t === 'room/view').pop()?.view;
const rosterNames = () => (view()?.advisors ?? []).filter((a) => a.kind === 'ai').map((a) => a.name).join(' ');

/** わざと外して命を使い切る */
async function playUntilOver(label) {
  for (let i = 0; i < 60; i++) {
    const v = view();
    if (!v) { await wait(300); continue; }
    if (v.phase === 'gameover') return true;
    if (!v.round) { await wait(300); continue; }
    await wait(300);
    // 外れそうな扉（誰も触れていない扉）を選ぶ
    const mentioned = new Set();
    for (const a of v.round.advice) {
      for (const c of v.round.room.choices) if (a.text.includes(c.label.ja)) mentioned.add(c.id);
    }
    const blind = v.round.room.choices.find((c) => !mentioned.has(c.id)) ?? v.round.room.choices[0];
    send({ t: 'challenger/choose', choiceId: blind.id, roundId: v.round.roundId });
    for (let k = 0; k < 6; k++) { send({ t: 'challenger/advance' }); await wait(200); }
  }
  console.log(`   （${label}: 命が尽きるまで行かなかった）`);
  return false;
}

send({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
await wait(1500);
const firstRoster = rosterNames();
check('一周目が始まる', !!view()?.round, JSON.stringify(view()?.phase));
const over1 = await playUntilOver('一周目');
check('命が尽きて終わりになる', over1, `${view()?.phase}`);
if (OUT) await p.screenshot({ path: `${OUT}/again-advisor-over.png`, fullPage: true });

// 助言者は待っている状態のままか（部屋から落とされていないか）
const waitingText = await p.evaluate(() => (document.querySelector('.board-prompt')?.textContent ?? '').trim());
console.log(`   助言者の画面: 「${waitingText}」`);
// 部屋は開いたまま次の周を待っている。「まだ開いていない」と出すと、
// 見ている側は閉じられたと思って離れる
check('周のあいだは「次の周を待っている」と出る', waitingText.includes('次の周'), waitingText);

// 同じ部屋のまま二周目
const before = inbox.length;
send({ t: 'challenger/start', mode: 'standard', locale: 'ja' });
let started = false;
for (let t = 0; t < 40; t++) {
  const v = view();
  if (v?.round && v.phase === 'choosing' && v.lives === v.maxLives) { started = true; break; }
  await wait(250);
}
check('同じ部屋のまま二周目が始まる', started, `${view()?.phase} 命${view()?.lives}`);
// 助言者が名簿に残っているか。ここが落ちると、繋がったままなのに
// 二周目は誰も発言枠に入れない（賭けの通算も白紙に戻る）
const humans = (view()?.advisors ?? []).filter((a) => a.kind === 'human');
check('助言者が名簿に残っている', humans.length >= 1, JSON.stringify(view()?.advisors ?? []));

// 助言者は入り直していないのに、二周目の部屋を受け取れているか
let gotRound = false;
for (let t = 0; t < 40; t++) {
  const cells = await p.evaluate(() => document.querySelectorAll('.cell').length);
  if (cells > 0) { gotRound = true; break; }
  await wait(250);
}
check('助言者は入り直さずに次の周を受け取る', gotRound);
const secondRoster = rosterNames();
console.log(`   一周目の顔ぶれ: ${firstRoster}`);
console.log(`   二周目の顔ぶれ: ${secondRoster}`);
check('AI の顔ぶれが周をまたいで同じ', firstRoster === secondRoster, `${firstRoster} / ${secondRoster}`);
void before;

check('例外なし', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
ws.close();
await b.close();
process.exit(fail ? 1 : 0);
