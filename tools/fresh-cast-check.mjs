/** 顔ぶれが入れ替わったことが画面に出るか。記録が黙って消えると不具合に見える */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [label, mode] of [['一人で遊ぶ', 'standard'], ['全員挑戦者', 'party']]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: new RegExp('^' + label) }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });
  await wait(3500);
  const first = await p.locator('.hints-note.is-fresh').count();
  check(`${mode}: 1部屋目に「顔ぶれが入れ替わった」が出る`, first === 1, `${first}件`);
  const text = await p.locator('.hints-note.is-fresh').textContent().catch(() => '');
  console.log(`   ${text}`);

  // 次の部屋では出ない
  await p.locator('.choice').first().click();
  await wait(9000);
  if (await p.locator('.choice').count()) {
    await wait(2000);
    const again = await p.locator('.hints-note.is-fresh').count();
    if (mode === 'standard') {
      // 通常モードは死ぬと区画の最初へ戻り、そこで顔ぶれごと引き直す。
      // 生き延びたなら顔ぶれは据え置きなので出ない
      const died = (await p.locator('.pip.is-lost').count()) > 0;
      if (died) check(`${mode}: 死んだ次の部屋でも出る（引き直したので）`, again === 1, `${again}件`);
      else check(`${mode}: 生き延びた次の部屋では出ない`, again === 0, `${again}件`);
    } else {
      // 全員挑戦者は死んでも部屋が進むだけ。裏切り者が変わるのは区画の境目
      check(`${mode}: 区画の途中では出ない`, again === 0, `${again}件`);
    }
  }
  check(`${mode}: 例外なし`, errors.length === 0, errors.join(' / '));
  await p.close();
}

/*
 * 崖っぷちだけ、白紙の知らせに手が添わるか。
 *
 * この部屋は読み方では数えるだけに勝てず、勝てるのは道具（黙らせる）のほうだった
 * （`tools/first-room-probe.mjs`：41.0% → 55.2%）。手引きで一度読んだだけでは
 * 思い出せないので、効く一瞬にその場で出している。**使ったあとは出さない。**
 */
{
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^崖っぷち/ }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });
  await wait(6000);
  const noteOf = () => p.locator('.hints-note.is-fresh').textContent().catch(() => '');
  const before = (await noteOf()) ?? '';
  check('崖っぷち: 白紙の部屋に「黙らせて一つ作れ」が添う', before.includes('黙らせて'), `「${before}」`);
  const btn = p.getByRole('button', { name: /^黙らせる$/ }).first();
  const had = await btn.count();
  check('崖っぷち: 一部屋目に黙らせる口がある', had > 0);
  if (had > 0) {
    await btn.click();
    await wait(900);
    const after = (await noteOf()) ?? '';
    check('崖っぷち: 使ったあとは添わない', !after.includes('黙らせて') && after.length > 0, `「${after}」`);
  }
  check('崖っぷち: 例外なし', errors.length === 0, errors.join(' / '));
  await p.close();
}
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
