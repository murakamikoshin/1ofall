import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const problems = [];

const MODES = [['一人で遊ぶ', 'standard'], ['崖っぷち', 'brink'], ['全員挑戦者', 'party']];
const VIEWS = [['pc', { width: 1280, height: 720 }], ['sp', { width: 375, height: 667 }]];

for (const [vname, viewport] of VIEWS) {
  for (const [label, id] of MODES) {
    const p = await b.newPage({ viewport, reducedMotion: vname === 'sp' ? 'reduce' : 'no-preference' });
    p.on('pageerror', e => problems.push(`${vname}/${id} 例外: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') problems.push(`${vname}/${id} console: ${m.text()}`); });
    await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
    await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: new RegExp('^' + label) }).click();
    await p.waitForSelector('.choice');
    // 助言が出そろうまで待つ
    await p.waitForTimeout(6000);

    const r = await p.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth > doc.clientWidth + 1;
      const clipped = [...document.querySelectorAll('.choice-label, .hint-text, .hint-name, .room-count')]
        .filter(e => e.scrollWidth > e.clientWidth + 1)
        .map(e => `${e.className}: ${e.textContent.slice(0, 24)}`);
      const tiny = [...document.querySelectorAll('button')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); })
        .map(e => `${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
      const noName = [...document.querySelectorAll('button')]
        .filter(e => !(e.textContent || '').trim() && !e.getAttribute('aria-label'))
        .map(e => e.className);
      return { overflowX, clipped, tiny, noName, hints: document.querySelectorAll('.hint-row').length };
    });
    if (r.overflowX) problems.push(`${vname}/${id} 横にはみ出している`);
    for (const c of r.clipped) problems.push(`${vname}/${id} 文字が切れている ${c}`);
    for (const t of r.tiny) problems.push(`${vname}/${id} 触れる的が小さい ${t}`);
    for (const n of r.noName) problems.push(`${vname}/${id} 名前のないボタン .${n}`);

    // キーボードだけで選択肢まで辿り着けるか
    let reached = false, seen = [];
    for (let i = 0; i < 40 && !reached; i++) {
      await p.keyboard.press('Tab');
      const cls = await p.evaluate(() => document.activeElement?.className ?? '');
      seen.push(cls.split(' ')[0]);
      if (cls.includes('choice')) reached = true;
    }
    if (!reached) problems.push(`${vname}/${id} Tab で選択肢に届かない: ${seen.join('>')}`);

    const outline = await p.evaluate(() => {
      const e = document.activeElement;
      if (!e) return 'none';
      const s = getComputedStyle(e);
      return `${s.outlineStyle} ${s.outlineWidth} / border ${s.borderColor}`;
    });
    await p.screenshot({ path: `${OUT}/a-${vname}-${id}.png`, fullPage: vname === 'sp' });
    console.log(`${vname}/${id} 助言${r.hints}件 焦点の見え方: ${outline}`);
    await p.close();
  }
}
console.log(problems.length ? '\n' + problems.map(x => '✗ ' + x).join('\n') : '\n問題なし');
await b.close();
