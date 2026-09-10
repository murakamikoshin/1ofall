/**
 * 人を指す一手を、本物のブラウザ・本物の線で通す。
 *
 * ここまで助言者の画面には**自分の一言しか出ていなかった**。
 * 8人が扉の名前を言うだけで、互いの言葉が見えないので会話が起きない。
 * この検査が通らないと、スマホで参加した人は誰も指せない。
 *
 *   node tools/point-live.mjs [出力先]
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
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.DEBUG && m.text().startsWith('[dbg]')) console.log(m.text()); });
// locator は要素が無いと自動待ちで30秒詰まる。DOM を直接読む
const dom = (sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const count = (sel) => p.evaluate((s) => document.querySelectorAll(s).length, sel);

let ok = false;
for (let attempt = 0; attempt < 6 && !ok; attempt++) {
  const room = `P${Date.now().toString(36).toUpperCase()}${attempt}`.slice(0, 6).padEnd(6, 'X');
  const ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
  const inbox = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await wait(200);

  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill(room);
  await p.locator('.field').nth(1).fill('けんしょう');
  await p.getByRole('button', { name: '入室' }).click();
  await wait(500);
  ws.send(JSON.stringify({ t: 'challenger/start', mode: 'standard', locale: 'ja' }));
  await p.waitForSelector('.cell', { timeout: 8000 });
  await wait(400);
  // 発言枠に入るまで部屋を立て直す。枠外だと指せないので検査にならない
  if ((await count('.compose-row')) === 0) { ws.close(); await wait(150); continue; }
  ok = true;

  // 仲間の言葉が場に出そろうのを待つ
  let rows = 0;
  for (let t = 0; t < 40; t++) {
    rows = await count('.floor-row');
    if (rows >= 3) break;
    await wait(200);
  }
  check('ほかの人の言葉が場に出る', rows >= 3, `${rows}件`);
  if (rows < 3) {
    console.log('   場のDOM:', await p.evaluate(() => document.querySelector('.floor')?.innerHTML ?? 'なし'));
  }
  const title = await dom('.floor-title');
  check('場の見出しが出る', title.includes('場に出ている'), title);

  // 自分の一言を出す前は撃てない
  check('言う前は撃つ手が無い', (await count('.floor-act')) === 0, `${await count('.floor-act')}個`);
  const need = await dom('.floor-note');
  check('先に言えと出る', need.includes('まず自分の一言'), need);

  const first = await p.evaluate(() => document.querySelector('.floor-row .floor-text')?.textContent ?? '');
  const myLabel = await p.evaluate(() => document.querySelector('.cell span')?.textContent ?? '');
  await p.locator('.compose-row .field').fill(`${myLabel}はやめろ`);
  await p.locator('.compose-row button').click();
  await wait(700);

  if (process.env.DEBUG) {
    console.log('   送った一言:', `${myLabel}はやめろ`, '／知らせ:', await dom('.board-notice'),
      '／断り:', await dom('.status'),
      '／入力:', await p.evaluate(() => document.querySelector('.compose-row .field')?.value ?? ''),
      '／送れる:', await p.evaluate(() => !document.querySelector('.compose-row button')?.disabled));
  }
  const acts = await count('.floor-act');
  check('言ったら撃つ手が出る', acts >= 2, `${acts}個`);
  if (OUT) await p.screenshot({ path: `${OUT}/point-floor.png`, fullPage: true });

  const targetName = await p.evaluate(() => document.querySelector('.floor-row .floor-name')?.textContent ?? '');
  await p.locator('.floor-act.is-doubt').first().click();

  await wait(600);
  const note = await dom('.floor-note');
  check('撃った相手が本人に出る', note.includes(targetName) && note.includes('撃った'), `「${note}」 相手=${targetName}`);
  check('押した手が残る', (await count('.floor-act.is-on')) === 1);

  // 挑戦者の画面に「人を指した一言」として並ぶか
  let seen = null;
  for (let t = 0; t < 30; t++) {
    const view = inbox.filter((m) => m.t === 'room/view').pop()?.view;
    seen = view?.round?.advice?.find((a) => a.advisorId && a.kind === 'call' && a.text.includes(targetName));
    if (seen) break;
    await wait(200);
  }
  check('挑戦者に「人を指した一言」として届く', !!seen, JSON.stringify(inbox.filter((m) => m.t === 'room/view').pop()?.view?.round?.advice ?? []));
  if (seen) console.log(`   「${seen.text}」（${seen.advisorName}）`);

  // 撃っても自分の扉についての一言が消えていないこと（別の口）
  const view = inbox.filter((m) => m.t === 'room/view').pop()?.view;
  const mine = (view?.round?.advice ?? []).filter((a) => a.advisorName === 'けんしょう');
  check('撃っても自分の一言が消えない', mine.some((a) => (a.kind ?? 'door') === 'door') && mine.some((a) => a.kind === 'call'),
    JSON.stringify(mine.map((a) => [a.kind, a.text])));
  void first;
  ws.close();
}

check('発言枠に入れた', ok);
check('例外なし', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
