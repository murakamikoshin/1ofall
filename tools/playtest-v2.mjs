/**
 * 新しい仕組みで遊ぶ。挑戦者は「ひらけるだけひらいて、多い方に賭ける」素朴な打ち手。
 * 人間ならここに読みが乗るので、これは腕前の下限にあたる。
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const RUNS = Number(process.argv[2] ?? 3);
const b = await chromium.launch({ executablePath: EXE });
const runs = [];
const errors = [];

for (let i = 0; i < RUNS; i++) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /一人で試す/ }).click();
  await p.waitForSelector('.choice:not([disabled])');

  const t0 = Date.now();
  let picks = 0, deepest = 0, opened = 0, repeats = 0, lastPrompt = null, guard = 0;

  while (guard++ < 90) {
    if (await p.locator('.end-screen').count()) break;
    await p.waitForFunction(() => document.querySelectorAll('.hint-open').length > 0, null, { timeout: 8000 })
      .catch(() => {});
    await p.waitForTimeout(500);

    const prompt = await p.locator('.prompt').textContent();
    if (prompt === lastPrompt) repeats++;
    lastPrompt = prompt;
    const rc = (await p.locator('.room-count').textContent()) ?? '';
    deepest = Math.max(deepest, parseInt(rc.match(/(\d+)部屋/)?.[1] ?? '0', 10));

    for (let k = 0; k < 6; k++) {
      const btn = p.locator('.hint-open:not([disabled])').first();
      if (!(await btn.count())) break;
      await btn.click();
      opened++;
      await p.waitForTimeout(60);
    }

    const texts = await p.locator('.hint-text').allTextContents();
    const labels = await p.$$eval('.choice', (els) =>
      els.map((e) => ({ id: e.dataset.choiceId, label: e.getAttribute('aria-label') ?? '' })));
    const score = new Map();
    for (const c of labels) score.set(c.id, 0);
    for (const tx of texts) {
      for (const c of labels) {
        if (!c.label || !tx.includes(c.label)) continue;
        const neg = /やめろ|罠|手を出すな|死ぬぞ/.test(tx);
        score.set(c.id, (score.get(c.id) ?? 0) + (neg ? -1 : 1));
      }
    }
    let best = labels[0]?.id, bestV = -Infinity;
    for (const [id, v] of score) if (v > bestV) { bestV = v; best = id; }

    await p.locator(`.choice[data-choice-id="${best}"]`).click();
    picks++;
    await p.waitForFunction(
      () => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'),
      null, { timeout: 25000 },
    );
  }

  const ended = await p.locator('.end-screen').count() > 0;
  const mark = ended ? (await p.locator('.end-mark').textContent())?.trim() : null;
  const stat = ended ? (await p.locator('.end-stat').first().textContent())?.trim() : null;
  runs.push({ picks, deepest, opened, repeats, sec: (Date.now() - t0) / 1000, mark, stat });
  await p.close();
}
await b.close();

const avg = (f) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
console.log('選択\t到達\t開封\t同室連続\t秒\t結果');
for (const r of runs) console.log(`${r.picks}\t${r.deepest}\t${r.opened}\t${r.repeats}\t${r.sec.toFixed(0)}\t${r.mark ?? '未終了'} ${r.stat ?? ''}`);
console.log(`\n選択 平均 ${avg(r=>r.picks).toFixed(1)}回 / 到達 平均 ${avg(r=>r.deepest).toFixed(1)}部屋`);
console.log(`生存率 ${((avg(r=>r.deepest)-1)/avg(r=>r.picks)*100).toFixed(0)}% 前後`);
console.log(`同じ部屋の連続 平均 ${avg(r=>r.repeats).toFixed(1)} 回`);
console.log(`実測 1周 平均 ${avg(r=>r.sec).toFixed(0)} 秒（ボットなので人間の思考時間は含まない）`);
if (errors.length) console.log('\nERRORS:\n' + errors.slice(0,5).join('\n'));
