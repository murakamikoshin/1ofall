/** 1周を通しで遊び、部屋ごとに何が起きたかを全部記録する */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice');

const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;
let guard = 0;

while (guard++ < 40) {
  if (await p.locator('.end-screen').count()) break;
  await p.waitForFunction(() => {
    const n = document.querySelectorAll('.hint-text').length;
    const w = window;
    if (w.__l === n) w.__s = (w.__s ?? 0) + 1; else { w.__s = 0; w.__l = n; }
    return n > 0 && w.__s >= 4;
  }, null, { timeout: 12000, polling: 200 }).catch(() => {});

  const hud = await p.locator('.room-count').textContent();
  const lives = await p.locator('.pip:not(.is-lost)').count();
  const prompt = await p.locator('.prompt').textContent();
  const labels = await p.$$eval('.choice', (e) => e.map((x) => ({ id: x.dataset.choiceId, label: x.getAttribute('aria-label') })));
  const rows = await p.$$eval('.hint-row', (els) => els.map((e) => ({
    name: e.querySelector('.hint-name')?.childNodes[0]?.textContent?.trim(),
    rec: e.querySelector('.hint-record')?.textContent ?? '',
    text: e.querySelector('.hint-text')?.textContent ?? '',
  })));

  const score = new Map(labels.map((c) => [c.id, 0]));
  for (const r of rows) {
    const touched = labels.filter((c) => c.label && r.text.includes(c.label));
    if (AVOID.test(r.text)) { for (const c of touched) score.set(c.id, score.get(c.id) - 0.9); continue; }
    const h = touched.length >= 2 || HEDGE.test(r.text);
    for (const c of touched) score.set(c.id, score.get(c.id) + (h ? 1.0 : 0.45));
  }
  const max = Math.max(...score.values());
  const top = [...score].filter(([, v]) => v === max).map(([id]) => id);
  const pickId = top[Math.floor(Math.random() * top.length)];
  const pickLabel = labels.find((c) => c.id === pickId)?.label;

  console.log(`\n=== ${hud}  命${lives}  「${prompt}」`);
  console.log(`    ${labels.map((c) => c.label).join(' / ')}`);
  for (const r of rows) console.log(`    ${(r.name ?? '').padEnd(7)}${r.rec.padEnd(9)} ${r.text}`);
  console.log(`    得点 ${[...score].map(([id, v]) => `${labels.find((c) => c.id === id)?.label}=${v.toFixed(1)}`).join(' / ')}`);
  console.log(`    選択 ${pickLabel}${top.length > 1 ? `  (${top.length}つ同点)` : ''}`);

  await p.locator(`.choice[data-choice-id="${pickId}"]`).click();
  await p.waitForFunction(() => {
    const n = document.querySelector('.banner');
    return n && n.textContent && n.classList.contains('is-visible');
  }, null, { timeout: 15000 }).catch(() => {});
  console.log(`    判定 ${(await p.locator('.banner').textContent())?.trim()}`);
  await p.waitForFunction(() => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'), null, { timeout: 25000 }).catch(() => {});
}
if (await p.locator('.end-screen').count()) {
  console.log('\n=== 終了:', (await p.locator('.end-mark').textContent())?.trim(),
    (await p.locator('.end-stat').first().textContent())?.trim());
}
await b.close();
