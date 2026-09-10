/**
 * 通報の道筋を通しで見る。野良で知らない人と遊ぶなら、
 * 通報が無い＝暴言を受けた人に何も手が無いということ。
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [label, mode] of [['一人で遊ぶ', 'standard'], ['全員挑戦者', 'party']]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: new RegExp('^' + label) }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });
  await wait(6000);

  const rows = await p.locator('.hint-row').count();
  const reports = await p.locator('.hint-report').count();
  check(`${mode}: 助言が並ぶ`, rows > 0, `${rows}行`);
  check(`${mode}: 通報の口がある`, reports > 0, `${rows}行のうち${reports}件`);
  if (mode === 'party') {
    check(`${mode}: 自分の発言には通報が付かない`, reports <= rows, `${reports}/${rows}`);
  }

  if (reports > 0) {
    const before = await p.locator('.hint-report').first().textContent();
    await p.locator('.hint-report').first().click();
    await wait(300);
    const after = await p.locator('.hint-report').first().textContent();
    const disabled = await p.locator('.hint-report').first().isDisabled();
    check(`${mode}: 押したら受け付けたと分かる`, after !== before && disabled, `${before} → ${after} / disabled=${disabled}`);
  }

  // 触れる的の大きさ（押し間違えると痛いボタン）
  const tiny = await p.evaluate(() => [...document.querySelectorAll('.hint-report, .hint-silence')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length);
  check(`${mode}: 通報の的が小さすぎない`, tiny === 0, `${tiny}件`);
  check(`${mode}: 例外なし`, errors.length === 0, errors.join(' / '));
  await p.close();
}
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
