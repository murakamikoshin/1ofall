import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];

// 挑戦者画面
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', m => { if (m.type() === 'error') errors.push('challenger: ' + m.text()); });
p.on('pageerror', e => errors.push('challenger pageerror: ' + e.message));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await p.screenshot({ path: `${OUT}/01-title.png` });

await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice');
await p.screenshot({ path: `${OUT}/02-room.png` });

// 死亡演出を撮る。わざと外す
const ids = await p.$$eval('.choice', els => els.map(e => e.dataset.choiceId));
await p.locator('.choice').first().click();
await p.waitForTimeout(400);            // 無音の最中
await p.screenshot({ path: `${OUT}/03-hush.png` });
await p.waitForTimeout(1000);           // 灯りが寄る
await p.screenshot({ path: `${OUT}/04-lamp.png` });
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/05-verdict.png` });
await p.waitForTimeout(1800);
await p.screenshot({ path: `${OUT}/06-answer.png` });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/07-next.png` });

// 助言者ページ（スマホ幅 375）
const m = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
m.on('pageerror', e => errors.push('advisor pageerror: ' + e.message));
m.on('console', c => { if (c.type() === 'error') errors.push('advisor: ' + c.text()); });
await m.goto('http://127.0.0.1:4173/advisor.html', { waitUntil: 'networkidle' });
await m.screenshot({ path: `${OUT}/10-advisor-enter.png` });
await m.locator('.field').first().fill('ABC123');
await m.getByRole('button', { name: '入室' }).click();
await m.waitForSelector('.cell', { timeout: 5000 });
await m.screenshot({ path: `${OUT}/11-advisor-board.png`, fullPage: true });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log('choices in first room:', ids.length);
await b.close();
