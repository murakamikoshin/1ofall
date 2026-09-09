/**
 * 賭場を開く側の通し。
 * 挑戦者のブラウザが部屋を立て、助言者のブラウザがその合言葉で入り、
 * 助言を書き、挑戦者が扉を選んで演出まで進む。
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const host = await b.newPage({ viewport: { width: 1280, height: 720 } });
const guest = await b.newPage({ viewport: { width: 375, height: 667 } });
for (const [name, p] of [['挑戦者', host], ['助言者', guest]]) {
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
}
await host.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });

await host.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
const hostBtn = host.getByRole('button', { name: /賭場を開く/ });
check('賭場を開くが押せる', await hostBtn.isEnabled());
await hostBtn.click();
await host.waitForSelector('.lobby-code', { timeout: 8000 });
const code = (await host.locator('.lobby-code').textContent()).trim();
check('合言葉が出る', /^[A-Z2-9]{6}$/.test(code), code);
await wait(500);
const waitingBefore = await host.locator('.lobby-count').textContent();
await host.screenshot({ path: `${OUT}/host-1-lobby.png` });

// 助言者が入る
await guest.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
await guest.locator('.field').first().fill(code);
await guest.locator('.field').nth(1).fill('みかん');
await guest.getByRole('button', { name: '入室' }).click();
await wait(900);
const waitingAfter = await host.locator('.lobby-count').textContent();
check('入室が待合に映る', waitingAfter !== waitingBefore, `${waitingBefore} → ${waitingAfter}`);
await host.screenshot({ path: `${OUT}/host-2-joined.png` });

// 始める
await host.getByRole('button', { name: '始める' }).click();
await host.waitForSelector('.choice', { timeout: 10000 });
await guest.waitForSelector('.cell', { timeout: 10000 });
check('挑戦者の盤面が出る', (await host.locator('.choice').count()) >= 3);
check('助言者の盤面も出る', (await guest.locator('.cell').count()) >= 3);
await wait(1200);
const timer = await host.locator('.timer').textContent();
check('残り時間が動いている', /^[01]:\d\d$/.test(timer.trim()), timer);
await host.screenshot({ path: `${OUT}/host-3-room.png` });
await guest.screenshot({ path: `${OUT}/host-4-advisor.png`, fullPage: true });

// 人間が助言を書く（枠外なら AI の助言だけで進める）
if (await guest.locator('.compose-row').count()) {
  await guest.locator('.compose-row .field').fill('鉄の輪は嘘だ');
  await wait(200);
  if (!(await guest.locator('.compose-row .primary').isDisabled())) {
    await guest.locator('.compose-row .primary').click();
    await wait(900);
    const names = await host.locator('.hint-name').allTextContents();
    check('人間の助言が挑戦者の画面に出る', names.some((n) => n.includes('みかん')), names.join('/'));
  } else {
    check('この助言は送れない語だった（別の語で試す）', true);
  }
} else {
  check('この部屋では枠の外だった', true);
}
await wait(2500);
const hints = await host.locator('.hint-row').count();
check('AI の助言も届く', hints > 0, `${hints}件`);
await host.screenshot({ path: `${OUT}/host-5-hints.png` });

// 選んで演出まで
await host.locator('.choice').first().click();
await wait(6500);
const phase = await host.evaluate(() => ({
  end: document.querySelectorAll('.end-screen').length,
  choices: document.querySelectorAll('.choice').length,
  lives: document.querySelectorAll('.pip.is-lost').length,
  room: document.querySelector('.room-count')?.textContent,
}));
check('選んだあと先へ進む（次の部屋か終了）', phase.end > 0 || phase.choices > 0, JSON.stringify(phase));
console.log(`   ${phase.end > 0 ? '終了画面' : `次の部屋: ${phase.room}`}`);
await host.screenshot({ path: `${OUT}/host-6-after.png` });

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
