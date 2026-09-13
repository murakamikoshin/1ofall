/**
 * 絵の一覧を作って、目で見る。
 *
 * 規約 §4 の「1枚ずつ見ると揃って見えるので必ず並べる」をそのまま道具にした。
 * 題材ごとに一行、その部屋の選択肢ぶん（最大6）を横に並べて画像に焼く。
 *
 *   node tools/art-sheet.mjs <出力png> [題材をカンマ区切り｜all]
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(tmpdir(), `sheet-${process.pid}.mjs`);
const root = resolve(here, '..');
await build({ entryPoints: [join(root, 'src/ui/art/render.ts')], bundle: true, format: 'esm',
  platform: 'node', outfile: out, logLevel: 'silent' });
const A = await import(pathToFileURL(out).href);

const PNG = process.argv[2] ?? join(root, 'art-sheet.png');
const WHICH = (process.argv[3] ?? 'all');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

// 題材ごとに、最初に出てくる部屋の選択肢を使う（実際に並ぶ絵をそのまま見る）
const rooms = new Map();
for (const r of pack.rooms) if (!rooms.has(r.theme)) rooms.set(r.theme, r);
const themes = WHICH === 'all' ? [...rooms.keys()] : WHICH.split(',');

const rowsHtml = themes.map((theme) => {
  const room = rooms.get(theme);
  if (!room) return `<div class="row"><div class="name">${theme}（部屋が無い）</div></div>`;
  const cells = room.choices.map((c, i) => {
    const uri = A.choiceArt(theme, room.id, c.id, undefined, i, c.label.en);
    return `<figure><img src="${uri}" width="128" height="128" alt=""><figcaption>${c.label.ja}</figcaption></figure>`;
  }).join('');
  return `<div class="row"><div class="name">${theme}</div><div class="cells">${cells}</div></div>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #2b2620; color: #c2b192; font: 12px system-ui, sans-serif; }
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #3a332b; }
  .name { width: 92px; text-align: right; color: #9c8f78; font-family: monospace; }
  .cells { display: flex; gap: 8px; }
  figure { margin: 0; width: 128px; text-align: center; }
  figcaption { margin-top: 2px; font-size: 10px; color: #8f8472; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  img { display: block; }
</style>${rowsHtml}`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1080, height: 900 } });
await p.setContent(html, { waitUntil: 'load' });
await p.screenshot({ path: PNG, fullPage: true });
await b.close();
console.log(`${themes.length}題材 → ${PNG}`);
