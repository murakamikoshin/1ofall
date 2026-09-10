/**
 * 野良の通し。二人が別々に待合へ並び、突き合わされて同じ部屋で遊び始める。
 * 「知らない人同士でもできる」がこのモードの売りなので、ここが通らないと意味がない。
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const pages = [];
for (let i = 0; i < 3; i++) {
  const p = await b.newPage({ viewport: i === 0 ? { width: 1280, height: 720 } : { width: 375, height: 667 } });
  p.on('pageerror', (e) => errors.push(`${i}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${i}: ${m.text()}`); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  pages.push(p);
}

// 一人目が並ぶ
await pages[0].goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
await pages[0].getByRole('button', { name: /野良で遊ぶ/ }).click();
await wait(800);
const first = await pages[0].locator('.lobby-count').textContent();
check('待合に並べる', /待っている/.test(first ?? ''), first);
await pages[0].screenshot({ path: `${OUT}/mm-1-waiting.png` });

// 二人目、三人目
for (const p of pages.slice(1)) {
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /野良で遊ぶ/ }).click();
  await wait(400);
}

// 3人揃ったら突き合わされる
await Promise.all(pages.map((p) => p.waitForSelector('.choice', { timeout: 25000 })));
check('三人とも部屋に入った', true);

const prompts = await Promise.all(pages.map((p) => p.locator('.prompt').textContent()));
check('全員が同じ部屋を見ている', new Set(prompts).size === 1, prompts.join(' / '));

const seats = await pages[0].locator('.party-seat').count();
check('席が埋まっている', seats >= 6, `${seats}席`);
const humans = await pages[0].locator('.party-name').allTextContents();
console.log(`   顔ぶれ: ${humans.join(' ')}`);
// 名指しは名前で読むものなので、同じ名前が二人いると誰の話か分からなくなる。
// 実際に「とんび」が二人並んでいた（AI の名を飛び飛びに引いていた）
const dupes = humans.filter((n, i) => humans.indexOf(n) !== i);
check('同じ名前が二人いない', dupes.length === 0, `重なり: ${dupes.join(' ')}`);
await pages[0].screenshot({ path: `${OUT}/mm-2-room.png` });
await pages[1].screenshot({ path: `${OUT}/mm-3-guest.png`, fullPage: true });

// 一人が助言 → 全員に届く
const labels = await pages[1].locator('.choice-label').allTextContents();
await pages[1].locator('.party-compose .field').fill(`${labels[0]}は死ぬ`);
await wait(200);
if (!(await pages[1].locator('.party-compose .primary').isDisabled())) {
  await pages[1].locator('.party-compose .primary').click();
  await wait(900);
  const seen = await pages[0].locator('.hint-row').count();
  check('知らない人の助言が届く', seen > 0, `${seen}件`);
} else {
  check('この語は送れなかった', true);
}

// 全員が選ぶ
for (const p of pages) await p.locator('.choice').first().click();
await wait(9000);
const after = await Promise.all(pages.map((p) => p.evaluate(() => ({
  end: document.querySelectorAll('.end-screen').length,
  choices: document.querySelectorAll('.choice').length,
  room: document.querySelector('.room-count')?.textContent,
}))));
check('全員が先へ進む', after.every((a) => a.end > 0 || a.choices > 0), JSON.stringify(after));
check('全員が同じ部屋にいる', new Set(after.map((a) => a.room)).size === 1, after.map((a) => a.room).join(' / '));
console.log(`   ${after[0].room ?? '終了'}`);
await pages[0].screenshot({ path: `${OUT}/mm-4-after.png` });

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
