/** 崖っぷちモードの設定を探す */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const limitsPath = resolve(root, 'src/core/limits.ts');
const original = readFileSync(limitsPath, 'utf8');

console.log('崖っぷち：1人以外みな嘘つき。発言枠と嘘率を探す\n');
console.log('発言枠 嘘率  迷いふり  決断率  罠率   腕の差  生存率  1周    短命  合格  最良の打ち手');
for (const slots of [4, 5, 6, 8]) {
  for (const honesty of [0.05, 0.15]) {
    for (const mimic of [0.25, 0.5]) {
      writeFileSync(limitsPath, original.replace(/roomsPerSection: \d+,/, 'roomsPerSection: 8,'));
      const script = `
        import { evaluate } from '${resolve(root, 'tools/rubric.mjs')}';
        const r = await evaluate('b', { brink: true, slots: ${slots}, honesty: () => ${honesty}, mimic: ${mimic} }, true);
        console.log(JSON.stringify({ m: r.m, pass: r.pass, best: r.bestName }));
      `;
      const o = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: root });
      const { m, pass, best } = JSON.parse(o.trim().split('\n').pop());
      const n = Object.values(pass).filter(Boolean).length;
      console.log(
        `${slots}人   ${honesty}  ${mimic}      ${m.決断率.toFixed(0).padStart(4)}%  ${m.群れの罠率.toFixed(0).padStart(3)}%  ` +
        `${m.腕の差.toFixed(1).padStart(5)}pt ${m.生存率.toFixed(1).padStart(5)}% ${m.一周分.toFixed(1).padStart(5)}分 ` +
        `${m.短命率.toFixed(0).padStart(3)}%  ${n}/7${n === 7 ? '★' : ' '} ${best}`
      );
    }
  }
}
writeFileSync(limitsPath, original.replace(/roomsPerSection: \d+,/, 'roomsPerSection: 8,'));
