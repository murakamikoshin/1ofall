/**
 * 常連——**顔ぶれが周をまたいで残るか**を、本物のブラウザで見る。
 *
 * ここまでソロは周ごとに AI の顔ぶれを引き直していた。裏切り癖は id から
 * 決まる作りなのに（`casting.ts`）、周が変わると名前ごと入れ替わるので、
 * 「とんびは信用を積んでから崩す」を覚えても次の周には居なかった。
 *
 * 見るのは三つ。
 *   1. 二周目に同じ12人が出るか（種を覚えているか）
 *   2. 振る舞いは引き直されているか（同じ助言が並ぶと作り物に見える）
 *   3. 区画を越えた相手の裏切り歴が、次の周の助言の行に出るか
 *
 *   node tools/regulars-check.mjs [出力先]
 */
import { chromium } from 'playwright';

const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => {
  for (const m of ['standard', 'brink', 'party']) localStorage.setItem(`briefed:${m}`, '1');
  // 前の検査が残した常連を持ち越さない
  localStorage.removeItem('regulars:seed');
  localStorage.removeItem('regulars:book');
});

const names = () => p.evaluate(() =>
  [...document.querySelectorAll('.hint-name')].map((e) => (e.childNodes[0]?.textContent ?? '').trim()));
const texts = () => p.evaluate(() =>
  [...document.querySelectorAll('.hint-text')].map((e) => (e.textContent ?? '').trim()));

/** 一周、命が尽きるまで遊ぶ。読みは雑でよい（顔ぶれを見るのが目的） */
async function playRun() {
  const seenNames = new Set();
  const seenTexts = [];
  let sheets = 0;
  for (let i = 0; i < 90; i++) {
    if (await p.locator('.end-screen').count()) break;
    if (await p.locator('.answer-veil').count()) {
      sheets++;
      await p.locator('.answer-go').click().catch(() => {});
      await wait(200);
      continue;
    }
    const open = await p.locator('.choice:not([disabled])').count();
    if (!open) { await wait(200); continue; }
    await wait(700);
    for (const n of await names()) if (n) seenNames.add(n);
    if (seenTexts.length < 24) seenTexts.push(...(await texts()));
    /*
     * 票が集まった扉を選ぶ（＝素朴な打ち手）。
     *
     * わざと外す打ち手にしていたら、区画の二部屋目までに死んで
     * **答え合わせの紙が一度も出なかった**（浅い死には紙を出さない作り）。
     * 常連帳は紙から積むので、それでは何も溜まらない。
     */
    const crowd = await p.evaluate(() => {
      const said = [...document.querySelectorAll('.hint-text')].map((e) => e.textContent ?? '');
      const cells = [...document.querySelectorAll('.choice')];
      let best = cells[0], bestN = -1;
      for (const c of cells) {
        const label = c.querySelector('.choice-label')?.textContent ?? '';
        if (!label) continue;
        const n = said.filter((t) => t.includes(label)).length;
        if (n > bestN) { bestN = n; best = c; }
      }
      return best?.dataset.choiceId ?? '';
    });
    if (crowd) await p.locator(`.choice[data-choice-id="${crowd}"]`).click().catch(() => {});
    for (let t = 0; t < 60; t++) {
      const ready = await p.evaluate(() =>
        document.querySelectorAll('.end-screen').length > 0
        || document.querySelectorAll('.answer-veil').length > 0
        || document.querySelectorAll('.choice:not([disabled])').length > 0);
      if (ready) break;
      await wait(200);
    }
    await wait(150);
  }
  return { names: [...seenNames], texts: seenTexts, sheets };
}

await p.goto('http://127.0.0.1:4173/?lang=ja&fast=1', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice', { timeout: 10000 });
const first = await playRun();
check('一周目が終わりまで行く', (await p.locator('.end-screen').count()) > 0);
check('区画の答え合わせを見ている', first.sheets > 0, `${first.sheets}回`);
if (OUT) await p.screenshot({ path: `${OUT}/regulars-1-end.png`, fullPage: true });

// 二周目
const actions = await p.evaluate(() =>
  [...document.querySelectorAll('.end-action')].map((e) => (e.textContent ?? '').trim()));
console.log(`   終わりの画面の口: ${actions.join(' / ')}`);
await p.locator('.end-action').first().click();
await p.waitForSelector('.choice', { timeout: 15000 });
const second = await playRun();

const shared = second.names.filter((n) => first.names.includes(n));
console.log(`   一周目 ${first.names.length}人 / 二周目 ${second.names.length}人　共通 ${shared.length}人`);
check('顔ぶれが周をまたいで残る（共通8人以上）', shared.length >= 8, shared.join(' '));

// 振る舞いは引き直す。同じ助言がそのまま並ぶと作り物に見える
const sameText = second.texts.filter((t, i) => first.texts[i] === t).length;
check('助言は周ごとに引き直される', sameText < Math.max(3, second.texts.length * 0.5),
  `${sameText}/${second.texts.length} が同じ`);

// 裏切り歴が助言の行に出る（区画を二度以上越えた相手だけ）
const book = await p.evaluate(() => JSON.parse(localStorage.getItem('regulars:book') ?? '{}'));
const veterans = Object.entries(book).filter(([, r]) => r.sections >= 2);
console.log(`   常連帳: ${Object.keys(book).length}人（2区画以上 ${veterans.length}人）`);
check('区画を越えた相手が常連帳に入る', veterans.length > 0, JSON.stringify(book).slice(0, 200));

const badges = await p.evaluate(() =>
  [...document.querySelectorAll('.hint-past')].map((e) => (e.textContent ?? '').trim()));
const endLine = await p.evaluate(() =>
  (document.querySelector('.end-stat.is-regulars:not([hidden])')?.textContent ?? '').trim());
console.log(`   行に出た札: ${badges.slice(0, 6).join(' ') || 'なし'}`);
if (endLine) console.log(`   終わりの画面: ${endLine}`);
check('裏切り歴が画面のどこかに出る', badges.length > 0 || endLine.length > 0,
  `札 ${badges.length}件 / 終わりの行「${endLine}」`);
if (badges.length) {
  check('札は「裏切n/m」の形', badges.every((t) => /^裏切\d+\/\d+$/.test(t)), badges.join(' '));
}
if (OUT) await p.screenshot({ path: `${OUT}/regulars-2-second.png`, fullPage: true });

check('例外なし', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
