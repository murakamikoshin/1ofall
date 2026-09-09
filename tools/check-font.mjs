/** 文字化け（豆腐）が出ていないかを、実際に描画して確かめる */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const missing = [];

await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /一人で試す|Play alone/ }).click();
await p.waitForSelector('.choice');
await p.waitForTimeout(1200);

// フォントが実際に当たっているか
const loaded = await p.evaluate(async () => {
  await document.fonts.ready;
  return [...document.fonts].map((f) => `${f.family} ${f.status}`);
});
console.log('読み込まれた書体:', loaded.join(' / ') || '(なし)');

// 使用中の全テキストについて、Koshin Pop で描けるか調べる
const report = await p.evaluate(async () => {
  await document.fonts.ready;
  const texts = new Set();
  document.querySelectorAll('.prompt, .choice-label, .room-count, .lives, .banner, .hint-text, .hints-count')
    .forEach((el) => texts.add(el.textContent ?? ''));
  const chars = [...new Set([...texts].join(''))].filter((c) => c.trim());
  const bad = chars.filter((c) => !document.fonts.check('700 16px "Koshin Pop"', c));
  return { total: chars.length, bad };
});
console.log(`画面上の文字 ${report.total} 種 / 書体に無い字 ${report.bad.length} 種`, report.bad.length ? report.bad.join('') : '');
if (report.bad.length) missing.push(...report.bad);

await p.screenshot({ path: process.argv[2] + '/40-font-ja.png' });

// 英語表示
await p.goto('http://127.0.0.1:4173/?lang=en', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /Play alone/ }).click();
await p.waitForSelector('.choice');
await p.waitForTimeout(1000);
await p.screenshot({ path: process.argv[2] + '/41-font-en.png' });

// 助言者ページ
const m = await b.newPage({ viewport: { width: 375, height: 812 } });
await m.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
await m.locator('.field').first().fill('ABC123');
await m.getByRole('button', { name: /入室|Enter/ }).click();
await m.waitForSelector('.cell');
await m.waitForTimeout(800);
await m.screenshot({ path: process.argv[2] + '/42-advisor.png', fullPage: true });

console.log(missing.length ? '文字化けの恐れあり' : '文字化けなし');
await b.close();
