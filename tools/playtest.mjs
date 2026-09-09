/**
 * 実際に遊んで、間合いと1周の長さを測る。
 * 挑戦者は正解を知らないので、人間と同じく当てずっぽうで選ぶ。
 */
import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

const runStart = Date.now();
await p.getByRole('button', { name: /一人で遊ぶ/ }).click();
await p.waitForSelector('.choice:not([disabled])');

const rooms = [];
let guard = 0;

while (guard++ < 40) {
  if (await p.locator('.end-screen').count()) break;

  const prompt = await p.locator('.prompt').textContent();
  const n = await p.locator('.choice').count();
  const roomNo = await p.locator('.room-count').textContent();
  const livesBefore = await p.locator('.pip:not(.is-lost)').count();

  // 当てずっぽう
  const pick = Math.floor(Math.random() * n);
  const chose = Date.now();
  await p.locator('.choice').nth(pick).click();

  // 結果の文字が出るまで（＝無音＋灯りが寄る時間）
  await p.waitForFunction(() => {
    const b = document.querySelector('.banner');
    return b && b.textContent && b.classList.contains('is-visible');
  }, null, { timeout: 15000 });
  const toVerdict = Date.now() - chose;
  const banner = (await p.locator('.banner').textContent())?.trim();
  const survived = banner === '通った';

  // 次の部屋が操作可能になるまで
  await p.waitForFunction(
    () => !!document.querySelector('.choice:not([disabled])') || !!document.querySelector('.end-screen'),
    null, { timeout: 20000 },
  );
  const toNext = Date.now() - chose;

  rooms.push({ roomNo, prompt, n, survived, banner, toVerdict, toNext, livesBefore });
}

const ended = await p.locator('.end-screen').count() > 0;
const endMark = ended ? (await p.locator('.end-mark').textContent())?.trim() : null;
const runMs = Date.now() - runStart;

console.log('部屋\t択\t結果\t選択→結果(ms)\t選択→次(ms)\t文言');
for (const r of rooms) {
  console.log(`${r.roomNo}\t${r.n}\t${r.survived ? '生' : '死'}\t${r.toVerdict}\t\t${r.toNext}\t\t${r.banner}`);
}
const dead = rooms.filter(r => !r.survived);
const alive = rooms.filter(r => r.survived);
console.log(`\n選択回数 ${rooms.length} / 生存 ${alive.length} / 死 ${dead.length}`);
console.log(`生存率 ${(alive.length / rooms.length * 100).toFixed(0)}%`);
if (alive.length) console.log(`生存演出 平均 ${Math.round(alive.reduce((s,r)=>s+r.toNext,0)/alive.length)} ms`);
if (dead.length)  console.log(`死亡演出 平均 ${Math.round(dead.reduce((s,r)=>s+r.toNext,0)/dead.length)} ms`);
console.log(`1周 ${(runMs/1000).toFixed(1)} 秒 / 終了: ${endMark ?? '未終了'}`);
await b.close();
