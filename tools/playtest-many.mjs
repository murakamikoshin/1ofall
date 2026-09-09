/** 何周も遊んで分布を出す */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const RUNS = Number(process.argv[2] ?? 12);
const b = await chromium.launch({ executablePath: EXE });
const runs = [];

for (let i = 0; i < RUNS; i++) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: /一人で試す/ }).click();
  await p.waitForSelector('.choice:not([disabled])');

  const t0 = Date.now();
  let picks = 0, survived = 0, deepest = 0, repeats = 0;
  let lastPrompt = null;
  let guard = 0;

  while (guard++ < 60) {
    if (await p.locator('.end-screen').count()) break;
    const roomNo = parseInt((await p.locator('.room-count').textContent()) ?? '0', 10);
    deepest = Math.max(deepest, roomNo);
    const prompt = await p.locator('.prompt').textContent();
    if (prompt === lastPrompt) repeats++;
    lastPrompt = prompt;

    const n = await p.locator('.choice').count();
    if (!n) break;
    await p.locator('.choice').nth(Math.floor(Math.random() * n)).click();
    picks++;
    await p.waitForFunction(
      () => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'),
      null, { timeout: 20000 },
    );
    const nowRoom = parseInt((await p.locator('.room-count').textContent()) ?? '0', 10);
    if (nowRoom > roomNo) survived++;
  }

  runs.push({ picks, survived, deepest, repeats, sec: (Date.now() - t0) / 1000 });
  await p.close();
}
await b.close();

const avg = (f) => (runs.reduce((s, r) => s + f(r), 0) / runs.length);
const med = (f) => { const a = runs.map(f).sort((x,y)=>x-y); return a[Math.floor(a.length/2)]; };
console.log(`${RUNS}周ぶんの結果`);
console.log(`到達した最深の部屋   平均 ${avg(r=>r.deepest).toFixed(1)} / 中央値 ${med(r=>r.deepest)} / 最大 ${Math.max(...runs.map(r=>r.deepest))}`);
console.log(`1周の選択回数        平均 ${avg(r=>r.picks).toFixed(1)}`);
console.log(`1周の所要時間        平均 ${avg(r=>r.sec).toFixed(1)} 秒 / 中央値 ${med(r=>r.sec).toFixed(1)} 秒`);
console.log(`同じ部屋を連続で見た回数 平均 ${avg(r=>r.repeats).toFixed(1)} 回/周`);
const total = runs.reduce((s,r)=>s+r.picks,0), surv = runs.reduce((s,r)=>s+r.survived,0);
console.log(`選択の生存率         ${(surv/total*100).toFixed(1)}%  (${surv}/${total})`);
