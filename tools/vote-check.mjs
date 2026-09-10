/**
 * 枠外の一票を、本物のブラウザ・本物の線で通す。
 *
 * 配信で視聴者が1000人いても発言できるのは8人。
 * 残りに渡せるのは自分の賭けだけなので、ここが通らないと
 * 99%の人は「見ているだけ」のままになる。
 *
 * 発言枠が4しかない崖っぷちを使う（通常は枠8で、枠外に回りにくい）。
 */
import { chromium } from 'playwright';

const HOST = '127.0.0.1:1999';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const p = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// locator は要素が無いと自動待ちで30秒詰まる。DOM を直接読む
const dom = (sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);

function openSocket(room) {
  const ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
  const inbox = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => res({ ws, inbox, send: (m) => ws.send(JSON.stringify(m)) }));
    ws.addEventListener('error', rej);
  });
}

let outside = false;
for (let attempt = 0; attempt < 5 && !outside; attempt++) {
  const room = `V${Date.now().toString(36).toUpperCase()}${attempt}`.slice(0, 6).padEnd(6, 'X');
  const ch = await openSocket(room);
  await wait(150);
  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill(room);
  await p.locator('.field').nth(1).fill('みかん');
  await p.getByRole('button', { name: '入室' }).click();
  await wait(400);
  ch.send({ t: 'challenger/start', mode: 'brink', locale: 'ja' });
  await p.waitForSelector('.cell', { timeout: 8000 });
  await wait(400);

  outside = (await p.locator('.compose-row').count()) === 0;
  if (!outside) { ch.ws.close(); await wait(120); continue; }

  const locked = await dom('.locked-note');
  check('枠外だと「票は届く」と出る', locked.includes('票は届く'), locked);
  const note = await dom('.pick-note');
  check('一票入れられると分かる', note.includes('一票'), note);
  check('扉が押せる', (await p.locator('.cell.is-pickable').count()) >= 3);

  await p.locator('.cell.is-pickable').first().click();
  await wait(250);
  check('入れた扉が残る', (await p.locator('.cell.is-voted').count()) === 1);
  const after = await dom('.pick-note');
  check('どこに入れたか出る', /に入れた$/.test(after), after);

  const view = ch.inbox.filter((m) => m.t === 'room/view').pop()?.view;
  const round = view?.round;
  check('挑戦者に画面ぶんが届いている', !!round);
  if (round) {
    ch.send({ t: 'challenger/choose', choiceId: round.room.choices[0].id, roundId: round.roundId });
    // 崖っぷちでは演出の段を挑戦者の画面が進める。合図がないと判定が立たない
    await wait(200);
    for (let i = 0; i < 4; i++) { ch.send({ t: 'challenger/advance' }); await wait(150); }

    let notice = '';
    for (let t = 0; t < 30; t++) {
      notice = await dom('.board-notice');
      if (notice.includes('通算')) break;
      await wait(200);
    }
    check('当たり外れと通算が本人に返る', /通算 当\d+ 外\d+/.test(notice), `「${notice}」`);
    // 通算だけでは自分が上手いのか下手なのか分からない。
    // 順位は「発言枠へ上がる道」そのものなので、賭けた人が二人以上いれば出す
    console.log(`   「${notice}」`);
    console.log(`   ${notice}`);
    if (process.argv[2]) await p.screenshot({ path: `${process.argv[2]}/vote.png`, fullPage: true });
  }
  ch.ws.close();
}
check('枠外に回った部屋で試せた', outside);
check('例外なし', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
