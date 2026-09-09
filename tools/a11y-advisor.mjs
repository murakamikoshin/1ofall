import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const problems = [];
for (const [name, viewport, lang, reduced] of [
  ['sp-ja', { width: 375, height: 667 }, 'ja', 'reduce'],
  ['sp-en', { width: 375, height: 667 }, 'en', 'no-preference'],
  ['xs-ja', { width: 320, height: 568 }, 'ja', 'no-preference'],
  ['pc-ja', { width: 1280, height: 720 }, 'ja', 'no-preference'],
]) {
  const p = await b.newPage({ viewport, reducedMotion: reduced });
  p.on('pageerror', e => problems.push(`${name} 例外: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`); });
  await p.goto(`http://127.0.0.1:4173/advisor.html?lang=${lang}`, { waitUntil: 'networkidle' });
  await p.locator('.field').first().fill('ABC123');
  await p.getByRole('button', { name: lang === 'ja' ? '入室' : /Enter|Join/ }).click();
  await p.waitForSelector('.cell', { timeout: 5000 });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const doc = document.documentElement;
    return {
      overflowX: doc.scrollWidth > doc.clientWidth + 1,
      clipped: [...document.querySelectorAll('button, label, p, span')]
        .filter(e => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1)
        .map(e => `${e.className || e.tagName}: ${(e.textContent || '').slice(0, 20)}`),
      tiny: [...document.querySelectorAll('button, input, textarea')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); })
        .map(e => `${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
      noName: [...document.querySelectorAll('button')]
        .filter(e => !(e.textContent || '').trim() && !e.getAttribute('aria-label')).map(e => e.className),
      unlabeledInput: [...document.querySelectorAll('input, textarea')]
        .filter(e => !e.getAttribute('aria-label') && !e.labels?.length && !e.placeholder).map(e => e.className),
    };
  });
  if (r.overflowX) problems.push(`${name} 横にはみ出している`);
  for (const x of r.clipped) problems.push(`${name} 文字が切れている ${x}`);
  for (const x of r.tiny) problems.push(`${name} 触れる的が小さい ${x}`);
  for (const x of r.noName) problems.push(`${name} 名前のないボタン .${x}`);
  for (const x of r.unlabeledInput) problems.push(`${name} 名前のない入力欄 .${x}`);
  await p.screenshot({ path: `${OUT}/adv-${name}.png`, fullPage: true });
  console.log(`${name} ok`);
  await p.close();
}
console.log(problems.length ? '\n' + problems.map(x => '✗ ' + x).join('\n') : '\n問題なし');
await b.close();
