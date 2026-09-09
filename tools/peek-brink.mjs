import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /崖っぷち/ }).click();
await p.waitForSelector('.choice');
for (let i = 0; i < 4; i++) {
  await p.waitForTimeout(4200);
  const hud = await p.locator('.room-count').textContent();
  const prompt = await p.locator('.prompt').textContent();
  const rows = await p.$$eval('.hint-row', (els) => els.map((e) => ({
    n: e.querySelector('.hint-name')?.childNodes[0]?.textContent?.trim(),
    r: e.querySelector('.hint-record')?.textContent ?? '',
    t: e.querySelector('.hint-text')?.textContent ?? '' })));
  console.log(`\n【${hud}】${prompt}`);
  for (const r of rows) console.log(`  ${(r.n ?? '').padEnd(7)}${r.r.padEnd(9)} ${r.t}`);
  await p.locator('.choice').first().click();
  await p.waitForFunction(() => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'), null, { timeout: 25000 }).catch(()=>{});
  if (await p.locator('.end-screen').count()) { console.log('\n終了'); break; }
}
await b.close();
