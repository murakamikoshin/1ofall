/**
 * 助言者ページを本物のブラウザで開き、本物の線でサーバーに繋いで、
 * 挑戦者役のスクリプトが進行を回す。人間が助言を書いて届くまでを見る。
 */
import { chromium } from 'playwright';

const HOST = '127.0.0.1:1999';
const OUT = process.argv[2];
const newRoom = () => `L${Date.now().toString(36).toUpperCase()}`.slice(0, 6).padEnd(6, 'X');
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 375, height: 667 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/**
 * 発言枠に入るまで部屋を立て直す。
 * 一番見たいのは「人間が書いた助言が挑戦者に届くか」なので、
 * 枠の外だったからと検査を飛ばすと意味がない。
 */
let ws = null, inbox = [], firstWait = null, attempt = 0;
for (; attempt < 6; attempt++) {
  const room = newRoom();
  ws = new WebSocket(`ws://${HOST}/parties/main/${room}`);
  inbox = [];
  const box = inbox;
  ws.addEventListener('message', (e) => box.push(JSON.parse(e.data)));
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  await wait(200);

  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill(room);
  await p.locator('.field').nth(1).fill('みかん');
  await p.getByRole('button', { name: '入室' }).click();
  await wait(600);
  if (firstWait === null) firstWait = (await p.locator('.cell').count()) === 0;

  ws.send(JSON.stringify({ t: 'challenger/start', mode: 'standard', locale: 'ja' }));
  await p.waitForSelector('.cell', { timeout: 8000 });
  await wait(300);
  if ((await p.locator('.compose-row').count()) > 0) break;
  ws.close();
  await wait(150);
}
check('繋いだ時点では部屋待ち', firstWait === true);
if (attempt > 0) console.log(`   （${attempt + 1}部屋目で発言枠に入った）`);
await p.screenshot({ path: `${OUT}/live-1-board.png` });

const board = await p.evaluate(() => ({
  title: document.querySelector('.role-title')?.textContent,
  note: document.querySelector('.role-note')?.textContent,
  prompt: document.querySelector('.board-prompt')?.textContent,
  cells: document.querySelectorAll('.cell').length,
  flags: [...document.querySelectorAll('.cell-flag')].map((e) => e.textContent),
  canWrite: document.querySelectorAll('.compose-row').length > 0,
}));
console.log(`   立場: ${board.title} / ${board.note}`);
console.log(`   問い: ${board.prompt}  印: ${board.flags.join(' / ') || 'なし'}`);
check('部屋が画面に出た', board.cells >= 3, JSON.stringify(board));
check('自分の立場が出ている', !!board.title);
check('印が付いている（自分の知識が届いている）', board.flags.length > 0);
await p.screenshot({ path: `${OUT}/live-2-board.png`, fullPage: true });

// 名簿に名乗った名前が入ったか
const roster = inbox.filter((m) => m.t === 'room/state').pop()?.roster ?? [];
check('名乗った名前が部屋に入っている', roster.some((a) => a.name === 'みかん'), JSON.stringify(roster.map((r) => r.name)));

check('発言枠に入った部屋で試せている', board.canWrite);
if (board.canWrite) {
  // 送れないものは送らせない（画面側の検査）
  await p.locator('.compose-row .field').fill('1番が正解');
  await wait(150);
  const blockedLocal = await p.evaluate(() => ({
    status: document.querySelector('.status')?.textContent,
    disabled: document.querySelector('.compose-row .primary')?.disabled,
  }));
  check('番号で指すと送信できない', blockedLocal.disabled === true, JSON.stringify(blockedLocal));
  await p.screenshot({ path: `${OUT}/live-3-blocked.png`, fullPage: true });

  // まともな助言は挑戦者に届く
  await p.locator('.compose-row .field').fill('石段は嘘だ');
  await wait(150);
  await p.locator('.compose-row .primary').click();
  await wait(700);
  const delivered = inbox.filter((m) => m.t === 'round/hints').some((m) => m.hints.some((h) => h.advisorName === 'みかん'));
  check('人間の助言が挑戦者に届く', delivered, JSON.stringify(inbox.filter((m) => m.t === 'round/hints').pop()?.hints?.map((h) => h.advisorName)));

  // 連投はサーバーが弾き、理由が画面に出る
  await p.locator('.compose-row .field').fill('板は死ぬ');
  await wait(120);
  await p.locator('.compose-row .primary').click();
  await wait(600);
  const notice = await p.evaluate(() => document.querySelector('.board-notice')?.textContent);
  check('サーバーに断られた理由が画面に出る', notice === '少し待て', `出たのは「${notice}」`);
  await p.screenshot({ path: `${OUT}/live-4-notice.png`, fullPage: true });
}

// 線が切れたら自分で戻る
await p.evaluate(() => { /* サーバー側から落とす代わりに、部屋を畳んで確かめる */ });
ws.close();
await wait(1500);
check('挑戦者が落ちても画面が壊れない', errors.length === 0, errors.join(' / '));

console.log(`\n${pass} 通過 / ${fail} 失敗${errors.length ? `\n例外: ${errors.join(' / ')}` : ''}`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
