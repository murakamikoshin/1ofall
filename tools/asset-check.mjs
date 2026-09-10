/**
 * 鳴らす名前と実物が揃っているか。
 *
 * 音は `Sfx` の名前からファイル名を組む（`snd/<name>.wav`）ので、
 * 名前を足してファイルを置き忘れても**型検査は通る**。
 * 鳴らない音は画面では気づけない（Howler は黙って何もしない）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

const src = readFileSync(resolve(root, 'src/ui/audio.ts'), 'utf8');
// VOLUMES の表がそのまま「鳴らす名前」の一覧になっている
const table = src.slice(src.indexOf('const VOLUMES'), src.indexOf('class AudioBus'));
const names = [...table.matchAll(/^\s*'?([a-z-]+)'?:\s*[\d.]+,/gm)].map((m) => m[1]);
check('鳴らす名前を読めた', names.length >= 8, `${names.length}種`);

const missing = [];
const empty = [];
for (const name of names) {
  const file = resolve(root, 'public/snd', `${name}.wav`);
  if (!existsSync(file)) { missing.push(name); continue; }
  if (statSync(file).size < 1000) empty.push(name);
}
console.log(`   ${names.length}種: ${names.join(' ')}`);
check('実物が全部ある', missing.length === 0, `無い: ${missing.join(' ')}`);
check('中身が空でない', empty.length === 0, `空: ${empty.join(' ')}`);

// 生成の台本にも揃っているか（gen:sfx を回し直したときに落ちないため）
const gen = readFileSync(resolve(root, 'scripts/gen-sfx.mjs'), 'utf8');
const built = [...gen.matchAll(/build\('([a-z-]+)\.wav'/g)].map((m) => m[1]);
const notGenerated = names.filter((n) => !built.includes(n));
check('生成の台本にも載っている', notGenerated.length === 0, `載っていない: ${notGenerated.join(' ')}`);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
