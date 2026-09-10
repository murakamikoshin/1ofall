/**
 * 終わりの画面を実際に見る。
 * 報いになっているか（何を持ち帰れるか）を確かめる。
 * 助言を待たずに押していくので、1周が速く終わる。
 */
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [label, mode] of [['一人で遊ぶ', 'standard'], ['崖っぷち', 'brink'], ['全員挑戦者', 'party']]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja&fast=1', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: new RegExp('^' + label) }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });

  // 当てずっぽうで押し続ける。命が尽きれば終わりの画面が出る。
  // 決め打ちで待たず、部屋が変わるまで見る
  for (let i = 0; i < 80; i++) {
    if (await p.locator('.end-screen').count()) break;
    const n = await p.locator('.choice:not([disabled])').count();
    if (!n) { await wait(150); continue; }
    // 部屋の番号だけで見分けると、死んで区画の頭へ戻ったときに
    // 前と同じ文字列になり、次の部屋が来ているのに12秒待ち続ける。
    // 命が増えたぶん死ぬ回数も増えたので、そのまま検査が遅くなっていた
    const key = await p.evaluate(() => {
      const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
      return `${t('.room-count')}|${t('.prompt')}`;
    });
    await p.locator('.choice:not([disabled])').nth(Math.floor(Math.random() * n)).click();
    for (let t = 0; t < 120; t++) {
      const moved = await p.evaluate((prev) => {
        const t2 = (s) => (document.querySelector(s)?.textContent ?? '').trim();
        const now = `${t2('.room-count')}|${t2('.prompt')}`;
        return document.querySelectorAll('.end-screen').length > 0 || (t2('.room-count') !== '' && now !== prev);
      }, key);
      if (moved) break;
      await wait(120);
    }
  }

  const end = await p.evaluate(() => {
    const txt = (e) => (e?.textContent ?? '').trim();
    return {
      shown: document.querySelectorAll('.end-screen').length > 0,
      mark: txt(document.querySelector('.end-mark')),
      stats: [...document.querySelectorAll('.end-stat')].map(txt),
      actions: [...document.querySelectorAll('.end-action')].map(txt),
    };
  });
  check(`${mode}: 終わりの画面が出る`, end.shown, JSON.stringify(end));
  if (end.shown) {
    console.log(`   ▼ ${end.mark}`);
    for (const s of end.stats) console.log(`     ${s}`);
    console.log(`     [${end.actions.join('] [')}]`);
    check(`${mode}: 何部屋まで行ったかが出る`, end.stats.some((s) => /部屋|room/i.test(s)), end.stats.join(' / '));
    check(`${mode}: 嘘つきが誰だったか開く`, end.stats.some((s) => /嘘つき|裏切/.test(s)), end.stats.join(' / '));
    // 卓を組み替えるたびに名前が増えて「ほぼ全員」になっていた
    const revealLines = end.stats.filter((s) => /嘘つき|裏切/.test(s));
    const worst = Math.max(0, ...revealLines.map((s) => (s.match(/、/g) ?? []).length + 1));
    check(`${mode}: 一行に名前が並びすぎない`, worst <= 5, `一行に最大${worst}人`);
    check(`${mode}: もう一度の口がある`, end.actions.length > 0, end.actions.join('/'));
    await p.screenshot({ path: `${OUT}/end-${mode}.png` });
  }
  check(`${mode}: 例外なし`, errors.length === 0, errors.join(' / '));
  await p.close();
}
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
