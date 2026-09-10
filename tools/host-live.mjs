/**
 * 賭場を開く側の通し。
 * 挑戦者のブラウザが部屋を立て、助言者のブラウザがその合言葉で入り、
 * 助言を書き、挑戦者が扉を選んで演出まで進む。
 */
import { chromium } from 'playwright';
const OUT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${d}`}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
// 死亡演出は「間」を含めて5秒近くある。命5で終わりまで行くと5回ぶん待つので、
// 動きを削る側で開く（間は残るが、検査の所要が半分になる）
const host = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
const guest = await b.newPage({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
for (const [name, p] of [['挑戦者', host], ['助言者', guest]]) {
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
}
await host.addInitScript(() => { for (const m of ['standard','brink','party']) localStorage.setItem(`briefed:${m}`, '1'); });

await host.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
const hostBtn = host.getByRole('button', { name: /賭場を開く/ });
check('賭場を開くが押せる', await hostBtn.isEnabled());
await hostBtn.click();
await host.waitForSelector('.lobby-code', { timeout: 8000 });
const code = (await host.locator('.lobby-code').textContent()).trim();
check('合言葉が出る', /^[A-Z2-9]{6}$/.test(code), code);
await wait(500);
const waitingBefore = await host.locator('.lobby-count').textContent();
await host.screenshot({ path: `${OUT}/host-1-lobby.png` });

// 助言者が入る
await guest.goto('http://127.0.0.1:4173/advisor.html?lang=ja', { waitUntil: 'networkidle' });
await guest.locator('.field').first().fill(code);
await guest.locator('.field').nth(1).fill('みかん');
await guest.getByRole('button', { name: '入室' }).click();
await wait(900);
const waitingAfter = await host.locator('.lobby-count').textContent();
check('入室が待合に映る', waitingAfter !== waitingBefore, `${waitingBefore} → ${waitingAfter}`);
await host.screenshot({ path: `${OUT}/host-2-joined.png` });

// 始める
await host.getByRole('button', { name: '始める' }).click();
await host.waitForSelector('.choice', { timeout: 10000 });
await guest.waitForSelector('.cell', { timeout: 10000 });
check('挑戦者の盤面が出る', (await host.locator('.choice').count()) >= 3);
check('助言者の盤面も出る', (await guest.locator('.cell').count()) >= 3);
await wait(1200);
const timer = await host.locator('.timer').textContent();
check('残り時間が動いている', /^[01]:\d\d$/.test(timer.trim()), timer);
await host.screenshot({ path: `${OUT}/host-3-room.png` });
await guest.screenshot({ path: `${OUT}/host-4-advisor.png`, fullPage: true });

// 人間が助言を書く（枠外なら AI の助言だけで進める）
if (await guest.locator('.compose-row').count()) {
  await guest.locator('.compose-row .field').fill('鉄の輪は嘘だ');
  await wait(200);
  if (!(await guest.locator('.compose-row .primary').isDisabled())) {
    await guest.locator('.compose-row .primary').click();
    await wait(900);
    const names = await host.locator('.hint-name').allTextContents();
    check('人間の助言が挑戦者の画面に出る', names.some((n) => n.includes('みかん')), names.join('/'));
  } else {
    check('この助言は送れない語だった（別の語で試す）', true);
  }
} else {
  check('この部屋では枠の外だった', true);
}
await wait(2500);
const hints = await host.locator('.hint-row').count();
check('AI の助言も届く', hints > 0, `${hints}件`);
await host.screenshot({ path: `${OUT}/host-5-hints.png` });

// 選んで演出まで
await host.locator('.choice').first().click();
await wait(6500);
const phase = await host.evaluate(() => ({
  end: document.querySelectorAll('.end-screen').length,
  choices: document.querySelectorAll('.choice').length,
  lives: document.querySelectorAll('.pip.is-lost').length,
  room: document.querySelector('.room-count')?.textContent,
}));
check('選んだあと先へ進む（次の部屋か終了）', phase.end > 0 || phase.choices > 0, JSON.stringify(phase));
console.log(`   ${phase.end > 0 ? '終了画面' : `次の部屋: ${phase.room}`}`);
await host.screenshot({ path: `${OUT}/host-6-after.png` });

/*
 * 一周終わったあとの口を見る。
 *
 * ここまで賭場は一周ごとに合言葉が変わっていた（終わりの画面から題名へ戻って
 * 開き直すと新しい6文字が振られる）。1周12分の遊びで、見ていた全員に
 * 毎周6文字を入れ直させることになっていた。
 * 終わりの画面に「同じ賭場でもう一度」が出ることを固定する。
 */
for (let i = 0; i < 60 && !(await host.locator('.end-screen').count()); i++) {
  // 区画の答え合わせが乗っていたら送る（16回目に足した段）
  if (await host.locator('.answer-veil').count()) {
    await host.locator('.answer-go').click().catch(() => {});
    await wait(250);
    continue;
  }
  const n = await host.locator('.choice:not([disabled])').count();
  if (!n) { await wait(200); continue; }
  // 誰も触れていない扉を選んで、命を早く使い切る
  const blind = await host.evaluate(() => {
    const said = [...document.querySelectorAll('.hint-text')].map((e) => e.textContent ?? '').join(' ');
    const cells = [...document.querySelectorAll('.choice')];
    const untouched = cells.find((c) => {
      const label = c.querySelector('.choice-label')?.textContent ?? '';
      return label && !said.includes(label);
    });
    return (untouched ?? cells[0])?.dataset.choiceId ?? '';
  });
  if (blind) await host.locator(`.choice[data-choice-id="${blind}"]`).click().catch(() => {});
  // 死亡演出は「間」を含めて5秒近くある。決め打ちで待つと、
  // 次の部屋が来る前に押して空振りし、そのまま止まる
  for (let t = 0; t < 60; t++) {
    const ready = await host.evaluate(() =>
      document.querySelectorAll('.end-screen').length > 0
      || document.querySelectorAll('.answer-veil').length > 0
      || document.querySelectorAll('.choice:not([disabled])').length > 0);
    if (ready) break;
    await wait(200);
  }
  await wait(250);
}
const ended = (await host.locator('.end-screen').count()) > 0;
check('賭場でも終わりの画面まで行ける', ended);
if (ended) {
  const actions = await host.evaluate(() =>
    [...document.querySelectorAll('.end-action')].map((e) => (e.textContent ?? '').trim()));
  check('同じ賭場でもう一度、が出る', actions.some((t) => t.includes('同じ賭場')), actions.join(' / '));
  // 一周の答え合わせ。view には嘘つきを載せないので、game/over を拾えていないと
  // 賭場の終わりの画面は毎回「嘘つきはいなかった」になる
  const reveal = await host.evaluate(() => ({
    screens: document.querySelectorAll('.end-screen').length,
    lines: [...document.querySelectorAll('.end-reveal .end-stat')].map((e) => (e.textContent ?? '').trim()),
  }));
  check('終わりの画面が二枚重なっていない', reveal.screens === 1, `${reveal.screens}枚`);
  // 開示が届いて描き直したときに、最高記録の更新が消えてはいけない
  const bestLine = await host.evaluate(() => (document.querySelector('.end-stat.is-best')?.textContent ?? '')
    || (document.querySelectorAll('.end-stat')[1]?.textContent ?? ''));
  check('最高記録の行が残っている', bestLine.trim().length > 0, `「${bestLine}」`);
  check('誰が嘘をついていたか開く',
    reveal.lines.length > 0 && !reveal.lines.some((t) => t.includes('いなかった')),
    reveal.lines.join(' / '));
  // 区画ぶんを足し合わせると9人並ぶ（＝ほぼ全員）ので、最後の卓だけ出す
  const most = Math.max(0, ...reveal.lines.map((t) => (t.match(/、/g) ?? []).length + 1));
  check('一行に名前が並びすぎない', most <= 5, `最大${most}人`);
  check('閉じる口もある', actions.some((t) => t.includes('閉じる')), actions.join(' / '));
  await host.getByRole('button', { name: '同じ賭場でもう一度' }).click();
  let back = false;
  for (let t = 0; t < 40; t++) {
    if ((await host.locator('.choice').count()) >= 3) { back = true; break; }
    await wait(250);
  }
  check('押すと同じ部屋のまま次の周が始まる', back);
  // 扉が DOM にあるだけでは足りない。終わりの画面が乗っていると盤面は見えない
  const covered = await host.evaluate(() => document.querySelectorAll('.end-screen').length);
  check('終わりの画面が盤面を覆っていない', covered === 0, `${covered}枚`);
  const stillIn = (await guest.locator('.cell').count()) >= 3;
  check('助言者は入り直さずに次の周へ入っている', stillIn);
  if (OUT) await host.screenshot({ path: `${OUT}/host-again.png` });
}

check('例外が出ていない', errors.length === 0, errors.join(' / '));
console.log(`\n${pass} 通過 / ${fail} 失敗`);
await b.close();
process.exit(fail > 0 ? 1 : 0);
