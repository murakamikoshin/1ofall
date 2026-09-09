/** 全画面の目視レビュー用。挑戦者の生存/死亡、スマホ幅、reduced-motion を撮る */
import { chromium } from 'playwright';
const OUT = process.argv[2];
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE });
const errors = [];
const watch = (p, tag) => {
  p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  p.on('console', c => { if (c.type() === 'error' && !/favicon|fonts\.g/.test(c.text())) errors.push(`${tag}: ${c.text()}`); });
};

// 生存ルートを撮るために、正解を知っている状態で正しく選ぶ手段が要る。
// 挑戦者クライアントは正解を持たない設計なので、全選択肢を順に試して
// 「通った」が出るまで回す（設計が守られている証明でもある）。
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
watch(p, 'challenger');
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await p.getByRole('button', { name: /一人で試す/ }).click();
await p.waitForSelector('.choice');

const leaked = await p.evaluate(() => document.body.innerHTML.includes('deathMessage'));
console.log('挑戦者DOMに正解らしき情報:', leaked ? 'あり(問題)' : 'なし');

// 生存演出
const ready = async (page) => {
  await page.waitForFunction(
    () => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'),
    null, { timeout: 20000 },
  );
};

let survived = false;
for (let attempt = 0; attempt < 8 && !survived; attempt++) {
  await ready(p);
  if (await p.locator('.end-screen').count()) break;
  const n = await p.locator('.choice').count();
  if (!n) break;
  await p.locator('.choice').nth(attempt % n).click();
  await p.waitForTimeout(1900);
  const banner = await p.locator('.banner').textContent();
  if (banner === '通った') {
    survived = true;
    await p.screenshot({ path: `${OUT}/20-survive.png` });
  }
}
console.log('生存演出を確認:', survived);

// 残機を使い切って全滅画面へ
for (let i = 0; i < 20; i++) {
  await ready(p);
  if (await p.locator('.end-screen').count()) break;
  if (!(await p.locator('.choice').count())) break;
  await p.locator('.choice').first().click();
}
if (await p.locator('.end-screen').count()) {
  await p.screenshot({ path: `${OUT}/21-gameover.png` });
  console.log('全滅画面: 到達');
} else {
  console.log('全滅画面: 未到達');
}

// 挑戦者のスマホ幅
const ms = await b.newPage({ viewport: { width: 375, height: 812 } });
watch(ms, 'challenger-mobile');
await ms.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await ms.getByRole('button', { name: /一人で試す/ }).click();
await ms.waitForSelector('.choice');
await ms.screenshot({ path: `${OUT}/22-challenger-375.png` });
const overflow = await ms.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('挑戦者375px 横スクロール:', overflow ? 'あり(問題)' : 'なし');

// reduced-motion でも「間」が残るか
const rm = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
watch(rm, 'reduced-motion');
await rm.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await rm.getByRole('button', { name: /一人で試す/ }).click();
await rm.waitForSelector('.choice');
const t0 = Date.now();
await rm.locator('.choice').first().click();
await rm.waitForFunction(() => document.querySelector('.banner')?.textContent, null, { timeout: 6000 });
console.log('reduced-motion で結果が出るまで:', Date.now() - t0, 'ms（800ms の無音が残っていること）');
await rm.screenshot({ path: `${OUT}/23-reduced-motion.png` });

// 助言者 375px
const ad = await b.newPage({ viewport: { width: 375, height: 812 } });
watch(ad, 'advisor');
await ad.goto('http://127.0.0.1:4173/advisor.html', { waitUntil: 'domcontentloaded' });
await ad.locator('.field').first().fill('ABC123');
await ad.getByRole('button', { name: '入室' }).click();
await ad.waitForSelector('.cell');
await ad.screenshot({ path: `${OUT}/24-advisor-375.png` });
const adOverflow = await ad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('助言者375px 横スクロール:', adOverflow ? 'あり(問題)' : 'なし');

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nコンソールエラーなし');
await b.close();
