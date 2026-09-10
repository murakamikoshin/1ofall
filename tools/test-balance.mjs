/**
 * 均衡が band から外れていないかを短時間で見張る。
 *
 * 実際に起きた事故：sed の当てどころを間違えて全員挑戦者の部屋数を
 * 5→6 に変えてしまい、最後まで残る割合が 50%→33% に落ちていた。
 * ルーブリックにも通しプレイにも出ず、終わりの画面の「24部屋のうち」
 * という表示で気づいた。数字は自動で見張る。
 *
 * 精度は粗い（周回数を絞ってある）。band も広く取ってある。
 * 細かく詰めるのは tools/rubric.mjs / party-sim.mjs / brink-probe.mjs。
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};
const run = (file, env) =>
  execFileSync('node', [resolve(root, 'tools', file)], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });

const num = (text, re) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : NaN;
};
const inBand = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

/* ── 通常と崖っぷち：7項目すべて満たすか ───────────────────────── */

const rubric = run('rubric.mjs', { LOCALE: 'ja', RUNS: '400' });
for (const [label, want] of [['通常', 7], ['崖っぷち', 7]]) {
  const block = rubric.split(`【${label}】`)[1] ?? '';
  const score = num(block, /→ (\d) \/ 7/);
  check(`${label}: ${want}/7 項目`, score === want, `${score}/7\n${block.split('\n').filter((l) => l.includes('×')).join('\n')}`);
}

/* ── 全員挑戦者：命が人ごとなので別の物差し ─────────────────────── */

const party = run('party-sim.mjs', { RUNS: '250', SEATS: '6' });
// 「設計どおり　82.5% 50.5% 76.5% 17.8 0.90 1.2」の行から拾う
const row = /設計どおり[　\s]+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%/.exec(party);
const perRoom = row ? Number(row[1]) : NaN;
const survivedToEnd = row ? Number(row[2]) : NaN;
const groupCleared = row ? Number(row[3]) : NaN;
const toEnd = num(party, /腕の差（最後まで）\s+([\d.]+)pt/);
const gap = num(party, /腕の差（1部屋あたり）\s+([\d.]+)pt/);
const luck = num(party, /運任せの部屋\s+([\d.]+)%/);
const rooms = num(party, /1周の部屋数\s+([\d.]+)/);
check('全員挑戦者: 1部屋あたりの生存 72〜88%', inBand(perRoom, 72, 88), `${perRoom}%`);
check('全員挑戦者: 腕の差 20pt以上', gap >= 20, `${gap}pt`);
check('全員挑戦者: 最後まで残る差 25pt以上', toEnd >= 25, `${toEnd}pt`);
check('全員挑戦者: 運任せの部屋 15%未満', luck < 15, `${luck}%`);
check('全員挑戦者: 1周 14〜24部屋', inBand(rooms, 14, 24), `${rooms}部屋`);
// ここが要。部屋数を1つ増やしただけで 50%→33% に落ちたことがある
check('全員挑戦者: 最後まで残る 40〜65%', inBand(survivedToEnd, 40, 65), `${survivedToEnd}%`);
check('全員挑戦者: 誰かが踏破 60〜88%', inBand(groupCleared, 60, 88), `${groupCleared}%`);

/* ── 崖っぷち：道具を使ったときの数字 ───────────────────────────── */

const brink = run('brink-probe.mjs', { RUNS: '200' });
const withProbe = brink.split('黙らせるを使う')[1] ?? '';
const bSurv = num(withProbe, /生存 ([\d.]+)%/);
const bClear = num(withProbe, /踏破 ([\d.]+)%/);
check('崖っぷち: 道具を使うと生存 65〜82%', inBand(bSurv, 65, 82), `${bSurv}%`);
check('崖っぷち: 道具を使うと踏破 5%以上', bClear >= 5, `${bClear}%`);

/* ── 通常：終わりに辿り着けるか ─────────────────────────────────── */

// 踏破は珍しい出来事なので、周回数を絞ると揺れが大きい（200周だと±2%）。
// 実測8%に対して band を 4% に置くには、これくらい回す必要がある
const std = run('brink-probe.mjs', { RUNS: '500', MODE: 'standard' });
const sClear = num(std.split('黙らせるを使わない')[1] ?? '', /踏破 ([\d.]+)%/);
check('通常: 踏破 4%以上（終わりの画面に辿り着ける）', sClear >= 4, `${sClear}%`);

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
