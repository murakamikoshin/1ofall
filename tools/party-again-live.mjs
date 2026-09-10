/**
 * 全員挑戦者モードの連戦を、線を張って通す。
 *
 * 賭場（一人が挑戦者・残りが助言者）の連戦は 12回目に直して again-live.mjs で
 * 固定した。全員挑戦者は**同じ形で書いた**が、一度も線を張って通していない。
 * 「同じ形だから大丈夫」は、game/over を取りこぼしていたのを見逃した理由そのもの。
 *
 *   node tools/party-again-live.mjs [出力先]
 */
import { chromium } from 'playwright';

const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
// 死ぬまで回すので動きは削る。間は残る
const host = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
const guest = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
for (const [n, p] of [['主', host], ['客', guest]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
}

await host.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
await host.getByRole('button', { name: /賭場を開く/ }).click();
await host.waitForSelector('.lobby-code', { timeout: 8000 });
const code = (await host.locator('.lobby-code').textContent()).trim();
await host.getByRole('button', { name: '全員挑戦者' }).click();

await guest.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
await guest.getByRole('button', { name: /合言葉で入る/ }).click();
await guest.waitForSelector('.join-code');
await guest.locator('.join-code').fill(code);
await guest.locator('.field').nth(1).fill('みかん');
await guest.getByRole('button', { name: '合言葉で入る' }).click();
await wait(900);
await host.getByRole('button', { name: '始める' }).click();
await host.waitForSelector('.choice', { timeout: 12000 });
await guest.waitForSelector('.choice', { timeout: 12000 });
check('二人とも盤面に入る', true);

/** 誰も触れていない扉を選び続けて、命を使い切る */
async function blindPick(p) {
  const id = await p.evaluate(() => {
    const said = [...document.querySelectorAll('.hint-text')].map((e) => e.textContent ?? '').join(' ');
    const cells = [...document.querySelectorAll('.choice:not([disabled])')];
    const untouched = cells.find((c) => {
      const label = c.querySelector('.choice-label')?.textContent ?? '';
      return label && !said.includes(label);
    });
    return (untouched ?? cells[0])?.dataset.choiceId ?? '';
  });
  if (id) await p.locator(`.choice[data-choice-id="${id}"]`).click().catch(() => {});
  return !!id;
}

for (let i = 0; i < 120; i++) {
  const done = await host.evaluate(() => document.querySelectorAll('.end-screen').length > 0);
  if (done) break;
  // 区画の答え合わせは押す口が無く、時間で消える。消えるまで待つ
  if (await host.locator('.answer-veil').count()) { await wait(600); continue; }
  await blindPick(host);
  await blindPick(guest);
  for (let t = 0; t < 60; t++) {
    const ready = await host.evaluate(() =>
      document.querySelectorAll('.end-screen').length > 0
      // 区画の答え合わせは全員挑戦者では時間で消える（押す口が無い）
      || document.querySelectorAll('.answer-veil').length > 0
      || document.querySelectorAll('.choice:not([disabled])').length > 0);
    if (ready) break;
    await wait(200);
  }
  await wait(250);
}
const hostEnded = (await host.locator('.end-screen').count()) > 0;
check('主が終わりの画面まで行く', hostEnded);
let guestEnded = false;
for (let t = 0; t < 40; t++) {
  if ((await guest.locator('.end-screen').count()) > 0) { guestEnded = true; break; }
  await wait(250);
}
check('客も終わりの画面まで行く', guestEnded);
if (OUT) {
  await host.screenshot({ path: `${OUT}/pa-1-host-end.png` });
  await guest.screenshot({ path: `${OUT}/pa-2-guest-end.png`, fullPage: true });
}
if (!hostEnded || !guestEnded) {
  console.log(`\n${pass} 通過 / ${fail} 失敗`);
  await b.close();
  process.exit(1);
}

const hostActions = await host.$$eval('.end-action', (els) => els.map((e) => (e.textContent ?? '').trim()));
const guestActions = await guest.$$eval('.end-action', (els) => els.map((e) => (e.textContent ?? '').trim()));
check('主に「同じ賭場でもう一度」が出る', hostActions.some((t) => t.includes('同じ賭場')), hostActions.join(' / '));
// 客が押しても部屋は開き直せない（開けるのは最初に繋いだ一人だけ）。
// 押せる口だけ出すと、押した客は終わりの画面を失って何も起きない
check('客には押しても効かない口が出ていない',
  !guestActions.some((t) => t.includes('同じ賭場')), guestActions.join(' / '));
check('客にも部屋を出る口はある', guestActions.some((t) => t.includes('出る')), guestActions.join(' / '));
const guestNote = await guest.evaluate(() => (document.querySelector('.end-stat.is-waiting')?.textContent ?? '').trim());
check('客には待っていると書いてある', guestNote.includes('待っている'), `「${guestNote}」`);

// 主が押す
await host.getByRole('button', { name: '同じ賭場でもう一度' }).click();
let hostBack = false;
for (let t = 0; t < 40; t++) {
  if ((await host.locator('.choice').count()) >= 3) { hostBack = true; break; }
  await wait(250);
}
check('主は同じ部屋のまま次の周へ入る', hostBack);
check('主の盤面が終わりの画面で覆われていない',
  (await host.locator('.end-screen').count()) === 0, `${await host.locator('.end-screen').count()}枚`);

// 客は入り直していない。次の周の盤面が見えているか
let guestBack = false;
for (let t = 0; t < 40; t++) {
  const covered = await guest.locator('.end-screen').count();
  const cells = await guest.locator('.choice').count();
  if (cells >= 3 && covered === 0) { guestBack = true; break; }
  await wait(250);
}
check('客も入り直さずに次の周の盤面が見える', guestBack,
  `扉${await guest.locator('.choice').count()} / 終わりの画面${await guest.locator('.end-screen').count()}枚`);
const sameRoom = await Promise.all([host, guest].map((p) =>
  p.evaluate(() => document.querySelector('.room-count')?.textContent ?? '')));
check('二人が同じ部屋にいる', sameRoom[0] === sameRoom[1] && sameRoom[0] !== '', sameRoom.join(' / '));
// 名簿が残っているか（周をまたいで席が消えると読みが台無しになる）
const seats = await host.locator('.party-seat').count();
const names = await host.locator('.party-name').allTextContents();
check('席が残っている', seats >= 6, `${seats}席`);
check('客の名前が名簿に残っている', names.some((n) => n.includes('みかん')), names.join('/'));
if (OUT) {
  await host.screenshot({ path: `${OUT}/pa-3-host-again.png` });
  await guest.screenshot({ path: `${OUT}/pa-4-guest-again.png`, fullPage: true });
}

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
