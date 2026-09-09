import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice');
await p.waitForFunction(() => document.querySelectorAll('.hint-open').length >= 6, null, { timeout: 9000 }).catch(()=>{});
await p.screenshot({ path: `${OUT}/30-closed.png` });
for (let i = 0; i < 3; i++) {
  const btn = p.locator('.hint-open:not([disabled])').first();
  if (!(await btn.count())) break;
  await btn.click();
  await p.waitForTimeout(200);
}
await p.screenshot({ path: `${OUT}/31-opened.png` });
const m = await b.newPage({ viewport: { width: 375, height: 812 } });
await m.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await m.getByRole('button', { name: /一人で遊ぶ/ }).click();
await m.waitForSelector('.choice');
await m.waitForFunction(() => document.querySelectorAll('.hint-open').length >= 4, null, { timeout: 9000 }).catch(()=>{});
await m.locator('.hint-open:not([disabled])').first().click();
await m.screenshot({ path: `${OUT}/32-mobile.png` });
const ov = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('375px 横スクロール:', ov ? 'あり(問題)' : 'なし');
await b.close();
