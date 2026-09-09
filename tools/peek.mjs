/** 実際に届いている助言を覗く */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice');
for (let room = 0; room < 3; room++) {
  await p.waitForTimeout(4200);
  const prompt = await p.locator('.prompt').textContent();
  const labels = await p.$$eval('.choice', (e) => e.map((x) => x.getAttribute('aria-label')));
  const rows = await p.$$eval('.hint-row', (els) => els.map((e) => ({
    name: e.querySelector('.hint-name')?.childNodes[0]?.textContent?.trim(),
    text: e.querySelector('.hint-text')?.textContent,
  })));
  console.log(`\n【${prompt}】 選択肢: ${labels.join(' / ')}`);
  for (const r of rows) console.log(`  ${(r.name ?? '').padEnd(8)} ${r.text}`);
  await p.locator('.choice').first().click();
  await p.waitForFunction(() => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'), null, { timeout: 20000 }).catch(()=>{});
  if (await p.locator('.end-screen').count()) break;
}
await b.close();
