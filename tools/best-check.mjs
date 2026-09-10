import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });

async function playUntilDeath() {
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
  for (let i = 0; i < 60; i++) {
    if (await p.locator('.end-screen').count()) break;
    if (await p.locator('.answer-veil').count()) {
      await p.locator('.answer-go').click().catch(() => {});
      await p.waitForTimeout(250);
      continue;
    }
    const n = await p.locator('.choice:not([disabled])').count();
    if (!n) { await p.waitForTimeout(500); continue; }
    await p.locator('.choice:not([disabled])').nth(Math.floor(Math.random() * n)).click();
    await p.waitForTimeout(6200);
  }
  await p.waitForSelector('.end-screen', { timeout: 20000 });
  return p.evaluate(() => [...document.querySelectorAll('.end-stat')].map(e => e.textContent));
}

console.log('1周目:', (await playUntilDeath()).join(' | '));
await p.screenshot({ path: `${OUT}/end-1.png` });
console.log('2周目:', (await playUntilDeath()).join(' | '));
await p.screenshot({ path: `${OUT}/end-2.png` });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
console.log('表題:', await p.locator('.menu-item').first().textContent());
console.log(errors.length ? '✗ ' + errors.join(' / ') : '問題なし');
await b.close();
