/** 全員挑戦者モードを、賭場で通しで見る。助言者も自分の扉を選ぶ */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const host = await b.newPage({ viewport: { width: 1280, height: 720 } });
const guest = await b.newPage({ viewport: { width: 375, height: 667 } });
for (const [n, p] of [['挑戦者', host], ['仲間', guest]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${n}: ${m.text()}`); });
}
await host.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });

let picked = false;
for (let attempt = 0; attempt < 6 && !picked; attempt++) {
  await host.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await host.getByRole('button', { name: /賭場を開く/ }).click();
  await host.waitForSelector('.lobby-code');
  const code = (await host.locator('.lobby-code').textContent()).trim();
  await host.getByRole('button', { name: '全員挑戦者' }).click();

  await guest.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
  await guest.locator('.field').first().fill(code);
  await guest.locator('.field').nth(1).fill('みかん');
  await guest.getByRole('button', { name: '入室' }).click();
  await wait(700);

  await host.getByRole('button', { name: '始める' }).click();
  await host.waitForSelector('.choice', { timeout: 10000 });
  await guest.waitForSelector('.cell', { timeout: 10000 });
  await wait(500);
  if (attempt === 0) {
    check('挑戦者の盤面が出る', (await host.locator('.choice').count()) >= 3);
    check('仲間の盤面も出る', (await guest.locator('.cell').count()) >= 3);
    const own = await host.locator('.choice-known').count();
    check('挑戦者にも自分の候補が配られている', own > 0, `${own}個`);
  }
  picked = (await guest.locator('.cell.is-pickable').count()) > 0;
  if (!picked) await wait(200);
}
check('仲間が自分の扉を選べる（発言枠に入るまでやり直した）', picked);
if (!picked) { console.log(`\n${pass} 通過 / ${fail} 失敗`); await b.close(); process.exit(1); }

const note = await guest.locator('.pick-note').textContent();
check('自分も通ると伝えている', note?.includes('命は自分持ち'), note);
await guest.screenshot({ path: `${OUT}/pm-1-advisor.png`, fullPage: true });

await guest.locator('.cell.is-pickable').first().click();
await wait(300);
const after = await guest.evaluate(() => ({
  picked: document.querySelectorAll('.cell.is-picked').length,
  note: document.querySelector('.pick-note')?.textContent,
}));
check('選んだ扉が残る', after.picked === 1, JSON.stringify(after));
check('何を通るか出る', /を通る$/.test(after.note ?? ''), after.note);
await guest.screenshot({ path: `${OUT}/pm-2-picked.png`, fullPage: true });

// 挑戦者が選ぶ → 仲間にも生死が返る
await host.locator('.choice').first().click();
await wait(7000);
const verdictNote = await guest.evaluate(() => document.querySelector('.board-notice')?.textContent);
check('仲間に自分の生死が返る', verdictNote === '通った' || verdictNote === '死んだ', `出たのは「${verdictNote}」`);
const partyRows = await host.locator('.hint-row').count();
check('挑戦者の画面に仲間の手が並ぶ', partyRows > 0, `${partyRows}行`);
await host.screenshot({ path: `${OUT}/pm-3-party.png` });
await guest.screenshot({ path: `${OUT}/pm-4-result.png`, fullPage: true });

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
