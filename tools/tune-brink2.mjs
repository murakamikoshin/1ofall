import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
console.log('崖っぷちの詰め\n');
console.log('発言 区切 命 嘘率 迷い   決断率  罠率   腕の差  生存率  1周    短命  合格');
let best = null;
for (const slots of [5, 6]) {
  for (const rooms of [4, 5]) {
    for (const lives of [6, 8]) {
      for (const [honesty, mimic] of [[0.3, 0.2], [0.35, 0.25]]) {
        const script = `
          import { evaluate } from '${resolve(root, 'tools/rubric.mjs')}';
          const r = await evaluate('b', { brink: true, loneKnows: true, slots: ${slots},
            rooms: ${rooms}, lives: ${lives}, sections: 4,
            honesty: (b) => Math.max(0.05, Math.min(0.5, ${honesty} * b)), mimic: ${mimic} }, true);
          console.log(JSON.stringify({ m: r.m, pass: r.pass, best: r.bestName }));`;
        const o = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: root });
        const { m, pass, best: bn } = JSON.parse(o.trim().split('\n').pop());
        const n = Object.values(pass).filter(Boolean).length;
        console.log(
          `${slots}人  ${rooms}  ${lives} ${honesty} ${mimic}   ${m.決断率.toFixed(0).padStart(4)}%  ${m.群れの罠率.toFixed(0).padStart(3)}%  ` +
          `${m.腕の差.toFixed(1).padStart(5)}pt ${m.生存率.toFixed(1).padStart(5)}% ${m.一周分.toFixed(1).padStart(5)}分 ` +
          `${m.短命率.toFixed(0).padStart(3)}%  ${n}/7${n === 7 ? ' ★' : ''}`);
        if (!best || n > best.n) best = { slots, rooms, lives, honesty, mimic, n, bn };
      }
    }
  }
}
console.log(`\n最良: 発言${best.slots} 区切${best.rooms} 命${best.lives} 嘘率${best.honesty} 迷い${best.mimic} → ${best.n}/7（${best.bn}）`);
