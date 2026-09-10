/**
 * 黙らせるを実際に押して、得た情報が画面に残るかを見る。
 * 崖っぷちはこの道具が遊びの中心なので、ここが通らないとモードが成立しない。
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /^崖っぷち/ }).click();
await p.waitForSelector('.choice', { timeout: 10000 });
await wait(6000);

const rows = await p.locator('.hint-row').count();
const silences = await p.locator('.hint-silence').count();
check('助言が並ぶ', rows > 0, `${rows}行`);
check('黙らせるの口がある', silences > 0, `${silences}件`);

// 一人ずつ黙らせて、当たりが出るまで（当たれば行が残るはず）
let hit = false;
for (let i = 0; i < 6 && !hit; i++) {
  if (!(await p.locator('.hint-silence:not([disabled])').count())) break;
  await p.locator('.hint-silence:not([disabled])').first().click();
  await wait(500);
  const notice = (await p.locator('.hud-notice.is-visible').textContent().catch(() => '')) ?? '';
  if (i === 0) check('当たり外れが目に見える', notice.length > 0, `「${notice}」`);
  hit = (await p.locator('.hint-row.is-confirmed').count()) > 0;
  if (!hit) {
    // 外したら次の部屋へ進めてやり直す
    await p.locator('.choice').first().click();
    await wait(8000);
    if (await p.locator('.end-screen').count()) break;
    await wait(5000);
  }
}
check('黙らせて当たると行が残る', hit, `is-confirmed=${await p.locator('.hint-row.is-confirmed').count()}`);
if (hit) {
  const text = await p.locator('.hint-row.is-confirmed .hint-text').first().textContent();
  console.log(`   ${text}`);
  check('嘘つきで確定と書いてある', (text ?? '').includes('確定'), text ?? '');
  // 一度に黙らせられるのは一人
  const left = await p.locator('.hint-silence:not([disabled])').count();
  check('一部屋に一人まで', left === 0, `まだ押せるものが${left}件`);
}
check('例外なし', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
