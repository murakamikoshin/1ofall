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
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
  await p.waitForSelector('.choice:not([disabled])');

  const t0 = Date.now();
  let picks = 0, deepest = 0, opened = 0, repeats = 0, lastPrompt = null, guard = 0;

  while (guard++ < 90) {
    if (await p.locator('.end-screen').count()) break;
    // 助言が出そろうまで待つ。増えなくなったら締め切りとみなす
    await p.waitForFunction(() => {
      const n = document.querySelectorAll('.hint-text').length;
      const w = window;
      if (w.__last === n) { w.__same = (w.__same ?? 0) + 1; } else { w.__same = 0; w.__last = n; }
      return n > 0 && w.__same >= 4;
    }, null, { timeout: 12000, polling: 200 }).catch(() => {});

    const prompt = await p.locator('.prompt').textContent();
    if (prompt === lastPrompt) repeats++;
    lastPrompt = prompt;
    const rc = (await p.locator('.room-count').textContent()) ?? '';
    deepest = Math.max(deepest, parseInt(rc.match(/(\d+)部屋/)?.[1] ?? '0', 10));

    opened += await p.locator('.hint-text').count();

    // 名前・記録・本文をまとめて取る。記録を読むのが新設計の要
    const rows = await p.$$eval('.hint-row', (els) => els.map((e) => ({
      rec: e.querySelector('.hint-record')?.textContent ?? '',
      text: e.querySelector('.hint-text')?.textContent ?? '',
    })));
    const labels = await p.$$eval('.choice', (els) =>
      els.map((e) => ({ id: e.dataset.choiceId, label: e.getAttribute('aria-label') ?? '' })));
    // 「どっちか」と迷っている助言は、触れた両方に薄く点を入れる。
    // 正解は全協力者の候補に必ず入るので、迷いを数えると浮かび上がる。
    const score = new Map();
    for (const c of labels) score.set(c.id, 0);
    // その人の記録（正n 嘘n）で重みを付けて数える。
    // 嘘つき全員が同じ罠へ誘うので、素朴に数えると罠を掴まされる。
    for (const r of rows) {
      const m = r.rec.match(/正(\d+)\s*嘘(\d+)/);
      const hit = m ? Number(m[1]) : 0;
      const miss = m ? Number(m[2]) : 0;
      const w = (hit + 1) / (hit + miss + 2);
      const touched = labels.filter((c) => c.label && r.text.includes(c.label));
      for (const c of touched) score.set(c.id, (score.get(c.id) ?? 0) + w);
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
