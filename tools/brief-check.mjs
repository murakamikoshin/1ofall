import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const log = [];

async function run(label, opts) {
  const p = await b.newPage(opts);
  p.on('console', m => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`${label} pageerror: ${e.message}`));
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });

  // 表題から手引きを開く（全モード分）
  await p.getByRole('button', { name: '手引き' }).click();
  await p.waitForSelector('.brief-sheet');
  const blocks = await p.$$eval('.brief-block-head', els => els.map(e => e.textContent));
  log.push(`${label} 表題手引き: ${blocks.join(' / ')}`);
  await p.screenshot({ path: `${OUT}/b1-${label}-guide-all.png`, fullPage: true });
  await p.getByRole('button', { name: '戻る' }).click();
  await p.waitForSelector('.menu-item');

  // 初回はモード別手引きが割り込む（通常モード。ここは時間が止まる）
  await p.getByRole('button', { name: /^一人で遊ぶ/ }).click();
  await p.waitForSelector('.brief-sheet');
  const soloLines = await p.$$eval('.brief-list li', els => els.map(e => e.textContent));
  log.push(`${label} 一人で遊ぶ手引き: ${soloLines.length}行`);
  await p.screenshot({ path: `${OUT}/b2-${label}-guide-solo.png`, fullPage: true });
  await p.getByRole('button', { name: '入る' }).click();
  await p.waitForSelector('.choice');

  // 対局中の手引き。持ち時間が止まるか
  const t1 = await p.locator('.timer').textContent();
  await p.locator('.hud-guide').click();
  await p.waitForSelector('.brief-veil');
  await p.screenshot({ path: `${OUT}/b3-${label}-guide-inrun.png` });
  await p.waitForTimeout(2500);
  const tPaused = await p.locator('.timer').textContent();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const veilGone = (await p.locator('.brief-veil').count()) === 0;
  const t2 = await p.locator('.timer').textContent();
  log.push(`${label} 時計: 開く前 ${t1} → 2.5秒後 ${tPaused} → 閉じた直後 ${t2} / 覆い消えた=${veilGone}`);
  await p.waitForTimeout(1500);
  const t3 = await p.locator('.timer').textContent();
  log.push(`${label} 再開後1.5秒: ${t3}`);

  // 二度目は割り込まない
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^一人で遊ぶ/ }).click();
  await p.waitForTimeout(400);
  const skipped = (await p.locator('.choice').count()) > 0;
  log.push(`${label} 二度目は素通り=${skipped}`);

  // 全員挑戦者では時間が止まらない。そう書いてあるか
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^全員挑戦者/ }).click();
  // 全員挑戦者は初回なので手引きが割り込む
  if (await p.locator('.brief-go').count()) await p.getByRole('button', { name: '入る' }).click();
  await p.waitForSelector('.choice');
  await p.locator('.hud-guide').click();
  await p.waitForSelector('.brief-veil');
  const partyNote = await p.locator('.brief-veil .brief-note').textContent();
  log.push(`${label} 全員挑戦者の手引き: ${partyNote}`);
  if (!partyNote?.includes('部屋は進む')) errors.push(`${label} 全員挑戦者で「時間が止まる」と嘘を書いている: ${partyNote}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);

  // 焦点が見えるか
  await p.keyboard.press('Tab');
  const focused = await p.evaluate(() => document.activeElement?.className ?? '(none)');
  log.push(`${label} Tab先: ${focused}`);
  await p.close();
}

await run('pc', { viewport: { width: 1280, height: 720 } });
await run('sp', { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
await run('reduce', { viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

// 英語も一度
const e = await b.newPage({ viewport: { width: 1280, height: 720 } });
e.on('pageerror', x => errors.push('en pageerror: ' + x.message));
await e.goto('http://127.0.0.1:4173/?lang=en', { waitUntil: 'networkidle' });
await e.getByRole('button', { name: 'How this works' }).click();
await e.waitForSelector('.brief-sheet');
await e.screenshot({ path: `${OUT}/b4-en-guide.png`, fullPage: true });
log.push('en 手引き: ' + (await e.$$eval('.brief-block-head', els => els.map(x => x.textContent))).join(' / '));

console.log(log.join('\n'));
console.log(errors.length ? '\n✗ ' + errors.join('\n✗ ') : '\n問題なし');
await b.close();
