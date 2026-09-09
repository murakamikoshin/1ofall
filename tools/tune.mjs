/** 基準を満たす設定を自動で探す */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const limitsPath = resolve(root, 'src/core/limits.ts');
const original = readFileSync(limitsPath, 'utf8');

const grid = [];
for (const frac of [0.44, 0.50, 0.56]) {
  for (const rooms of [6, 8]) {
    for (const mimic of [0.15, 0.25]) {
      grid.push({ frac, mimic, lie: 0.8, rooms, slots: '[8, 7, 6, 8]' });
    }
  }
}

console.log('通常モードの探索\n');
console.log('嘘つき 部屋 迷いふり     決断率  罠率   腕の差  生存率  1周    短命  合格');
let best = null;
for (const g of grid) {
  writeFileSync(limitsPath, original
    .replace(/export const LIAR_FRACTION = [\d.]+;/, `export const LIAR_FRACTION = ${g.frac};`)
    .replace(/export const LIE_RATE = [\d.]+;/, `export const LIE_RATE = ${g.lie};`)
    .replace(/roomsPerSection: \d+,/, `roomsPerSection: ${g.rooms},`)
    .replace(/slotsBySection: \[[^\]]*\],/, `slotsBySection: ${g.slots},`));
  const script = `
    import { evaluate } from '${resolve(root, 'tools/rubric.mjs')}';
    const r = await evaluate('x', { honesty: (b) => Math.max(0.05, Math.min(0.45, ${1 - g.lie} * b)), mimic: ${g.mimic} }, true);
    console.log(JSON.stringify({ m: r.m, pass: r.pass, best: r.bestName }));
  `;
  const outText = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: root });
  const { m, pass, best: bn } = JSON.parse(outText.trim().split('\n').pop());
  const n = Object.values(pass).filter(Boolean).length;
  console.log(
    `${g.frac}  ${String(g.rooms).padStart(2)} ${String(g.mimic).padEnd(5)}        ${m.決断率.toFixed(0).padStart(4)}%  ${m.群れの罠率.toFixed(0).padStart(3)}%  ` +
    `${m.腕の差.toFixed(1).padStart(5)}pt ${m.生存率.toFixed(1).padStart(5)}% ${m.一周分.toFixed(1).padStart(5)}分 ` +
    `${m.短命率.toFixed(0).padStart(3)}%  ${n}/7${n === 7 ? ' ★' : ''}`
  );
  if (!best || n > best.n) best = { ...g, n, m, bn };
}
writeFileSync(limitsPath, original);
console.log(`\n最良: 嘘つき${best.frac} 部屋${best.rooms} 発言枠${best.slots} → ${best.n}/7（最良の打ち手＝${best.bn}）`);
