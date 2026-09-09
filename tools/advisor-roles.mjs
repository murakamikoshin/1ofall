import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const problems = [];
for (const lang of ['ja', 'en']) {
  for (const as of ['liar', 'trapper', 'honest2', 'honest3', 'doomed']) {
    const p = await b.newPage({ viewport: { width: 375, height: 667 } });
    p.on('pageerror', e => problems.push(`${lang}/${as} 例外: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') problems.push(`${lang}/${as} console: ${m.text()}`); });
    await p.goto(`http://127.0.0.1:4173/advisor.html?lang=${lang}&as=${as}`, { waitUntil: 'networkidle' });
    await p.locator('.field').first().fill('ABC123');
    await p.getByRole('button', { name: lang === 'ja' ? '入室' : /Enter|Join/ }).click();
    await p.waitForSelector('.cell');
    const r = await p.evaluate(() => ({
      title: document.querySelector('.role-title')?.textContent,
      note: document.querySelector('.role-note')?.textContent,
      flags: [...document.querySelectorAll('.cell-flag')].map(e => e.textContent),
      liarFrame: document.querySelector('.is-liar') !== null,
    }));
    console.log(`[${lang}/${as}] ${r.title} — ${r.note}\n    印: ${r.flags.join(' / ') || '(なし)'}  嘘つき配色=${r.liarFrame}`);
    if (lang === 'ja') await p.screenshot({ path: `${OUT}/role-${as}.png`, fullPage: true });
    await p.close();
  }
}
console.log(problems.length ? '\n' + problems.map(x => '✗ ' + x).join('\n') : '\n問題なし');
await b.close();
