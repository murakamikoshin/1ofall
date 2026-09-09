import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
p.on('console', c => { if (c.type()==='error') console.log('CONSOLE:', c.text()); });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
console.log('body:', (await p.locator('body').innerHTML()).slice(0, 400));
await b.close();
