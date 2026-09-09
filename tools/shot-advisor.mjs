/** 助言者ページの三種の知識（目利き・半可通・耳打ち）と嘘つきを撮る */
import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const seen = new Set();
for (let attempt = 0; attempt < 14 && seen.size < 3; attempt++) {
  const p = await b.newPage({ viewport: { width: 375, height: 812 } });
  await p.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'domcontentloaded' });
  await p.locator('.field').first().fill('ABC123');
  await p.getByRole('button', { name: '入室' }).click();
  await p.waitForSelector('.cell', { timeout: 6000 }).catch(() => {});
  const flags = await p.$$eval('.cell-flag', (e) => e.map((x) => x.textContent));
  const kind = flags.includes('これは死ぬ') ? 'doomed'
    : flags.includes('生きる方') ? 'liar'
    : flags.filter((f) => f === 'このどちらか').length === 2 ? 'narrow2'
    : flags.length === 3 ? 'narrow3' : 'other';
  if (!seen.has(kind) && kind !== 'other') {
    seen.add(kind);
    await p.screenshot({ path: `${OUT}/adv-${kind}.png`, fullPage: true });
    console.log(`撮影: ${kind}  flags=${flags.join('/')}`);
  }
  await p.close();
}
console.log('撮れた種類:', [...seen].join(', '));
await b.close();
