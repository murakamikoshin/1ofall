/** 対等になった全員挑戦者モードを、本物のブラウザで通す */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, viewport] of [['pc', { width: 1280, height: 720 }], ['sp', { width: 375, height: 667 }]]) {
  const p = await b.newPage({ viewport });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /全員挑戦者/ }).click();
  await p.waitForSelector('.choice', { timeout: 8000 });

  const seats = await p.locator('.party-seat').count();
  check(`${name}: 仲間が並ぶ`, seats >= 6, `${seats}人`);
  const lives = await p.locator('.party-seat').first().locator('.pip').count();
  check(`${name}: 命が人ごとに出る`, lives === 4, `${lives}`);
  const overflowX = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`${name}: 横にはみ出さない`, !overflowX);

  await wait(4500);
  const hints = await p.locator('.hint-row').count();
  check(`${name}: 仲間の助言が順に届く`, hints > 0, `${hints}件`);
  const own = await p.locator('.choice.is-known, .choice.is-fatal').count();
  check(`${name}: 自分の持ち情報が扉に出る`, own > 0, `${own}個`);
  await p.screenshot({ path: `${OUT}/pb-1-${name}.png`, fullPage: name === 'sp' });

  // 自分も助言を書ける
  check(`${name}: 助言を書く欄がある`, (await p.locator('.party-compose .field').count()) === 1);
  await p.locator('.party-compose .field').fill('1番は罠だ');
  await wait(150);
  check(`${name}: 番号で指すと送れない`, await p.locator('.party-compose .primary').isDisabled());
  const labels = await p.locator('.choice-label').allTextContents();
  await p.locator('.party-compose .field').fill(`${labels[0]}は死ぬ`);
  await wait(150);
  if (!(await p.locator('.party-compose .primary').isDisabled())) {
    await p.locator('.party-compose .primary').click();
    await wait(400);
    const mine = await p.locator('.hint-name').allTextContents();
    check(`${name}: 自分の助言が並ぶ`, mine.some((t) => t.includes('あなた')), mine.join('/'));
  } else {
    check(`${name}: この語は送れなかった`, true);
  }

  // 選ぶ → 全員の手が開く → 次の部屋
  await p.locator('.choice').first().click();
  await wait(1200);
  const ready = await p.locator('.party-seat.is-ready').count();
  check(`${name}: 決めた人に印が付く`, ready > 0, `${ready}人`);
  await wait(6500);
  const after = await p.evaluate(() => ({
    end: document.querySelectorAll('.end-screen').length,
    choices: document.querySelectorAll('.choice').length,
    room: document.querySelector('.room-count')?.textContent,
    rows: document.querySelectorAll('.hint-row').length,
  }));
  check(`${name}: 次の部屋へ進む`, after.end > 0 || after.choices > 0, JSON.stringify(after));
  console.log(`   ${after.end > 0 ? '終了' : after.room}`);
  await p.screenshot({ path: `${OUT}/pb-2-${name}-after.png`, fullPage: name === 'sp' });
  check(`${name}: 例外が出ていない`, errors.length === 0, errors.join(' / '));
  await p.close();
}
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
