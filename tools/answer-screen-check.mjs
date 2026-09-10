/**
 * 区画の答え合わせを、本物のブラウザで見る。
 *
 * 見るのは「出るか」だけではない。
 *   ・区画を離れた瞬間に出て、押すと次の部屋へ入るか（詰まらないか）
 *   ・嘘つきの行に印が付いているか
 *   ・「よく当てていたのに嘘つきだった」が数字のほうから読めるか
 *   ・電話の画面（375x667）で紙面が収まる／中で巻けるか
 */
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? '/tmp';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ONLY = process.env.ONLY ?? '';
for (const [label, viewport] of [
  ['pc', { width: 1280, height: 800 }],
  ['sp', { width: 375, height: 667 }],
].filter(([l]) => !ONLY || l === ONLY)) {
  const p = await b.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });
  await p.goto('http://127.0.0.1:4173/?lang=ja&fast=1', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^一人で遊ぶ/ }).click();
  await p.waitForSelector('.choice', { timeout: 10000 });

  let sheets = 0, liarMarked = 0, built = 0, overflowed = 0, stuck = 0;
  let scored = 0, doubtsPlaced = 0, doubtShown = 0;
  let firstShot = false;
  // 区画の頭で落ちると答え合わせは出ない（記録が薄い紙は出さない決まり）。
  // 一周で境目まで届かないこともあるので、命が尽きたら周を張り直す
  let runs = 1;
  for (let i = 0; i < 240 && sheets < 3; i++) {
    if (await p.locator('.end-screen').count()) {
      if (runs >= 6) break;
      runs++;
      await p.locator('.end-action').first().click().catch(() => {});
      await wait(400);
      if (await p.getByRole('button', { name: /^一人で遊ぶ/ }).count()) {
        await p.getByRole('button', { name: /^一人で遊ぶ/ }).click();
      }
      await p.waitForSelector('.choice', { timeout: 10000 }).catch(() => {});
      continue;
    }
    if (await p.locator('.answer-veil').count()) {
      sheets++;
      const info = await p.evaluate(() => {
        const sheet = document.querySelector('.answer-sheet');
        const rows = [...document.querySelectorAll('.answer-row')];
        return {
          heading: document.querySelector('.answer-heading')?.textContent ?? '',
          rows: rows.map((r) => ({
            liar: r.classList.contains('is-liar'),
            text: (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
          })),
          // 紙面が画面から出ていないか（出ていても中で巻ければよい）
          score: (document.querySelector('.answer-score')?.textContent ?? '').trim(),
          doubtedRows: document.querySelectorAll('.answer-row.is-doubted').length,
          over: sheet ? sheet.scrollHeight - sheet.clientHeight : 0,
          scrollable: sheet ? getComputedStyle(sheet).overflowY : '',
          bodyOver: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      if (info.rows.some((r) => r.liar)) liarMarked++;
      // 疑いの札を置いていたら、点が出て、置いた行に印が付く
      if (info.score) scored++;
      if (info.doubtedRows > 0) doubtShown++;
      if (info.rows.some((r) => r.text.includes('積んで、崩した'))) built++;
      if (info.over > 0 && info.scrollable !== 'auto' && info.scrollable !== 'scroll') overflowed++;
      if (info.bodyOver) overflowed++;
      if (!firstShot) {
        firstShot = true;
        console.log(`   ${label} 「${info.heading}」`);
        for (const r of info.rows) console.log(`     ${r.liar ? '●' : '○'} ${r.text}`);
        console.log(`     読み: ${info.score}（印の付いた行 ${info.doubtedRows}）`);
        await p.screenshot({ path: `${OUT}/answer-${label}.png` });
      }
      await p.getByRole('button', { name: '次へ' }).click();
      // 押したら次の部屋へ入るか
      let back = false;
      for (let t = 0; t < 40; t++) {
        if (await p.locator('.answer-veil').count()) { await wait(150); continue; }
        if ((await p.locator('.choice:not([disabled])').count()) > 0
          || (await p.locator('.end-screen').count()) > 0) { back = true; break; }
        await wait(150);
      }
      if (!back) stuck++;
      continue;
    }
    const n = await p.locator('.choice:not([disabled])').count();
    if (!n) { await wait(150); continue; }
    // 疑いの札を置く。置かないと答え合わせに点が出ない（置いた人だけの行）
    const buttons = await p.locator('.hint-doubt:not(.is-on)').count();
    if (buttons > 0) {
      await p.locator('.hint-doubt:not(.is-on)').first().click().catch(() => {});
      doubtsPlaced++;
      await wait(80);
    }
    /*
     * 区画の境目まで届かないと答え合わせが見られないので、そこそこ強く打つ。
     * 「名の挙がった扉」だけで選んでいたら4周で一度も境目に届かなかった
     * （群れに従うと死ぬ、という設計どおりの結果）。
     * 記録の良い者が名を挙げた扉を採り、名の集まりすぎた扉を避ける。
     */
    const id = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.hint-row')].map((r) => {
        const rec = (r.querySelector('.hint-record')?.textContent ?? '').match(/(\d+)\D+(\d+)/);
        return {
          text: r.querySelector('.hint-text')?.textContent ?? '',
          score: rec ? Number(rec[1]) - Number(rec[2]) : 0,
        };
      });
      const cells = [...document.querySelectorAll('.choice:not([disabled])')];
      let best = null;
      let bestScore = -Infinity;
      for (const c of cells) {
        const label = c.querySelector('.choice-label')?.textContent ?? '';
        if (!label) continue;
        const said = rows.filter((r) => r.text.includes(label));
        const trust = said.length ? Math.max(...said.map((r) => r.score)) : 0;
        // 名の挙がっていない扉を避けるのが先。記録は上積みとして使う。
        // 「名の集まりすぎた扉を避ける」を先に置いたら、区画の頭では
        // 誰にも記録が無いので**誰も触れていない扉ばかり選び**、
        // 6周とも一部屋目で死んだ（群れを外すのは記録を読めてからの手）
        const score = said.length + trust * 2;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return (best ?? cells[0])?.dataset.choiceId ?? '';
    });
    if (id) await p.locator(`.choice[data-choice-id="${id}"]`).click().catch(() => {});
    for (let t = 0; t < 60; t++) {
      const ready = await p.evaluate(() => document.querySelectorAll('.answer-veil').length > 0
        || document.querySelectorAll('.end-screen').length > 0
        || document.querySelectorAll('.choice:not([disabled])').length > 0);
      if (ready) break;
      await wait(150);
    }
    await wait(120);
  }

  console.log(`   ${label} ${runs}周で 答え合わせ ${sheets}回`);
  check(`${label}: 区画を離れると答え合わせが出る`, sheets > 0, `${sheets}回`);
  check(`${label}: 嘘つきの行に印が付く`, sheets === 0 || liarMarked > 0, `${liarMarked}/${sheets}`);
  check(`${label}: 押すと次の部屋へ入る（詰まらない）`, stuck === 0, `${stuck}回詰まった`);
  check(`${label}: 紙面が画面から出ない`, overflowed === 0, `${overflowed}回`);
  check(`${label}: 疑いの札が置ける`, doubtsPlaced > 0, `${doubtsPlaced}回`);
  check(`${label}: 答え合わせに読みの点が出る`, sheets === 0 || scored === sheets, `${scored}/${sheets}`);
  check(`${label}: 札を置いた行に印が付く`, sheets === 0 || doubtShown > 0, `${doubtShown}/${sheets}`);
  check(`${label}: 例外なし`, errors.length === 0, errors.join(' / '));
  if (built > 0) console.log(`   ${label} 「積んで、崩した」が ${built}回出た`);
  await p.close();
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
