import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /全員挑戦者/ }).click();
await p.waitForSelector('.choice');
for (let i = 0; i < 3; i++) {
  await p.waitForTimeout(4200);
  const prompt = await p.locator('.prompt').textContent();
  const known = await p.$$eval('.choice.is-known', (e) => e.map((x) => x.getAttribute('aria-label')));
  const rows = await p.$$eval('.hint-row', (els) => els.map((e) => ({
    n: e.querySelector('.hint-name')?.childNodes[0]?.textContent?.trim(),
    r: e.querySelector('.hint-record')?.textContent ?? '',
    t: e.querySelector('.hint-text')?.textContent ?? '' })));
  console.log(`\n【${prompt}】  自分が知っている範囲: ${known.join(' / ')}`);
  for (const r of rows) console.log(`  ${(r.n ?? '').padEnd(7)}${r.r.padEnd(9)} ${r.t}`);
  await p.locator('.choice').first().click();
  await p.waitForTimeout(2600);
  const head = await p.locator('.hints-count').textContent().catch(() => '');
  const party = await p.$$eval('.hint-row', (els) => els.map((e) => e.querySelector('.hint-text')?.textContent ?? ''));
  console.log(`  --- 結果: ${head}`);
  for (const t of party) console.log(`      ${t}`);
  await p.waitForFunction(() => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'), null, { timeout: 25000 }).catch(()=>{});
  if (await p.locator('.end-screen').count()) break;
}
await b.close();
