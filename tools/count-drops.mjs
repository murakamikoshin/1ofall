/** 発言枠の人数に対して、何通の助言が実際に画面に出ているかを数える */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice');

let rooms = 0, shown = 0, expected = 0;
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(4400);
  const head = await p.locator('.hints-count').textContent();
  const n = await p.locator('.hint-row').count();
  const m = head?.match(/(\d+)人が助言/);
  const say = m ? parseInt(m[1], 10) : 0;
  // 区画1の発言枠は8人
  console.log(`部屋${i + 1}: 表示 ${n} 通 / ヘッダ ${say} 人`);
  rooms++; shown += n; expected += 8;
  await p.locator('.choice').first().click();
  // 区画の切れ目の答え合わせを送る（16回目）。送らないと5部屋目で止まる
  await p.waitForFunction(() => !!document.querySelector('.choice:not([disabled])')
    || !!document.querySelector('.end-screen')
    || !!document.querySelector('.answer-veil'), null, { timeout: 20000 }).catch(()=>{});
  if (await p.locator('.answer-veil').count()) {
    await p.locator('.answer-go').click().catch(()=>{});
    await p.waitForTimeout(400);
  }
  if (await p.locator('.end-screen').count()) break;
}
console.log(`\n平均 ${(shown / rooms).toFixed(1)} 通 / 発言枠 8 人 → 欠落 ${(8 - shown / rooms).toFixed(1)} 通`);
await b.close();
