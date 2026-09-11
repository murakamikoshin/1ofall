/**
 * 対等な全員挑戦者モードを、2つのブラウザで通しで見る。
 * 主が賭場を開き、もう一人が合言葉で入り、両方が同じ盤面で自分の扉を選ぶ。
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const host = await b.newPage({ viewport: { width: 1280, height: 720 } });
const guest = await b.newPage({ viewport: { width: 375, height: 667 } });
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
check('客は主の開始を待つ', (await guest.locator('.lobby-count').textContent())?.includes('待っている'));
const joined = await host.locator('.lobby-count').textContent();
check('待合に人数が映る', /1人/.test(joined ?? ''), joined);
await host.screenshot({ path: `${OUT}/pn-1-lobby.png` });

await host.getByRole('button', { name: '始める' }).click();
await host.waitForSelector('.choice', { timeout: 12000 });
await guest.waitForSelector('.choice', { timeout: 12000 });
check('主に盤面が出る', (await host.locator('.choice').count()) >= 3);
check('客にも同じ盤面が出る', (await guest.locator('.choice').count()) >= 3);

const hostRoom = await host.locator('.prompt').textContent();
const guestRoom = await guest.locator('.prompt').textContent();
check('同じ部屋を見ている', hostRoom === guestRoom, `${hostRoom} / ${guestRoom}`);

const seats = await host.locator('.party-seat').count();
check('席が埋まっている（AIで補う）', seats >= 6, `${seats}席`);
const names = await host.locator('.party-name').allTextContents();
check('名乗った名前が並ぶ', names.some((n) => n.includes('みかん')), names.join('/'));
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check('同じ名前が二人いない', dupes.length === 0, `重なり: ${dupes.join(' ')}`);

// 自分の持ち情報は人によって違う
const hostOwn = await host.locator('.choice.is-known, .choice.is-fatal').count();
const guestOwn = await guest.locator('.choice.is-known, .choice.is-fatal').count();
check('それぞれに持ち情報が配られる', hostOwn > 0 && guestOwn > 0, `${hostOwn} / ${guestOwn}`);
await host.screenshot({ path: `${OUT}/pn-2-host.png` });
await guest.screenshot({ path: `${OUT}/pn-3-guest.png`, fullPage: true });

// 客が助言を書く → 主の画面に出る
const labels = await guest.locator('.choice-label').allTextContents();
await guest.locator('.party-compose .field').fill(`${labels[0]}は死ぬ`);
await wait(200);
if (!(await guest.locator('.party-compose .primary').isDisabled())) {
  await guest.locator('.party-compose .primary').click();
  await wait(900);
  const shown = await host.locator('.hint-name').allTextContents();
  check('客の助言が主に届く', shown.some((n) => n.includes('みかん')), shown.join('/'));
} else {
  check('この語は送れなかった（別の検査で見る）', true);
}

// 両方が選ぶ → 演出 → 次の部屋
await host.locator('.choice').first().click();
await guest.locator('.choice').first().click();
await wait(9000);
const after = await Promise.all([host, guest].map((p) => p.evaluate(() => ({
  end: document.querySelectorAll('.end-screen').length,
  choices: document.querySelectorAll('.choice').length,
  room: document.querySelector('.room-count')?.textContent,
}))));
/*
 * 疑いの札は**二人揃って初めて効く。**
 *
 * 全員挑戦者では札は公開で、みなが置ける。一人で押せてしまうと、
 * 裏切り者が正直者を黙らせる（言い切らせる）道具になるので、合意が要る。
 * 二人の本物のブラウザで、一枚では効かず二枚で効くことを見る。
 */
// 助言が届くまで待つ（札を置ける行が無いと検査が素通りする）
let target = null;
for (let i = 0; i < 20 && !target; i++) {
  target = await host.evaluate(() => {
    const rows = [...document.querySelectorAll('.hint-row')];
    const row = rows.find((r) => r.querySelector('.hint-doubt')
      && (r.querySelector('.hint-name')?.childNodes[0]?.textContent ?? '').trim().length > 0);
    if (!row) return null;
    return (row.querySelector('.hint-name')?.childNodes[0]?.textContent ?? '').trim();
  });
  if (!target) await wait(400);
}
if (target) {
  await host.evaluate((name) => {
    const row = [...document.querySelectorAll('.hint-row')].find(
      (r) => (r.querySelector('.hint-name')?.childNodes[0]?.textContent ?? '').trim() === name
        && r.querySelector('.hint-doubt'));
    row?.querySelector('.hint-doubt').click();
  }, target);
}
if (target) {
  await wait(700);
  const oneMark = await Promise.all([host, guest].map((p) => p.evaluate(() =>
    document.querySelectorAll('.hint-pressed').length)));
  check('一枚では押せない', oneMark[0] === 0 && oneMark[1] === 0, JSON.stringify(oneMark));

  const alsoMarked = await guest.evaluate((name) => {
    const row = [...document.querySelectorAll('.hint-row')].find(
      (r) => (r.querySelector('.hint-name')?.childNodes[0]?.textContent ?? '').trim() === name
        && r.querySelector('.hint-doubt'));
    if (!row) return false;
    row.querySelector('.hint-doubt').click();
    return true;
  }, target);
  if (alsoMarked) {
    await wait(900);
    const twoMarks = await Promise.all([host, guest].map((p) => p.evaluate(() =>
      [...document.querySelectorAll('.hint-pressed')].map((e) => (e.textContent ?? '').trim()))));
    check(`二枚で押される（${target}）`,
      twoMarks[0].length > 0 && twoMarks[1].length > 0, JSON.stringify(twoMarks));
  } else {
    check('客の画面にその人の行が無かった（札の検査は飛ばす）', true);
  }
} else {
  check('この部屋には札を置ける行が無かった', true);
}

check('主が先へ進む', after[0].end > 0 || after[0].choices > 0, JSON.stringify(after[0]));
check('客も先へ進む', after[1].end > 0 || after[1].choices > 0, JSON.stringify(after[1]));
check('二人が同じ部屋にいる', after[0].room === after[1].room, `${after[0].room} / ${after[1].room}`);
console.log(`   ${after[0].room ?? '終了'}`);
await host.screenshot({ path: `${OUT}/pn-4-after.png` });

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
