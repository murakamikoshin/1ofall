import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [w, h] of [[1280,720],[1366,768],[375,667],[375,812],[900,500]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:4173/?lang=ja', { waitUntil: 'networkidle' });
  const r = await p.evaluate(() => {
    const s = document.querySelector('.title-screen');
    const link = document.querySelector('.brief-link').getBoundingClientRect();
    return { scroll: s.scrollHeight > s.clientHeight, linkBottom: Math.round(link.bottom), vh: innerHeight };
  });
  console.log(`${w}x${h}  はみ出し=${r.scroll}  手引きの下端=${r.linkBottom}/${r.vh}`);
  await p.screenshot({ path: `${process.argv[2]}/t-${w}x${h}.png` });
  await p.close();
}
await b.close();
