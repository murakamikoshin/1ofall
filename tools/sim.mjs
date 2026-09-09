/**
 * 読み合いの芯を検証する。
 * 実物の castRound()（発言枠と嘘つきの配役）をそのまま使い、
 * 助言者の振る舞いと挑戦者の方針だけをモデル化する。
 *
 * 問いは一つ：「挑戦者は多数決で勝ててしまわないか」
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `casting-${process.pid}.mjs`);
await build({ entryPoints: [resolve(root, 'src/core/casting.ts')], bundle: true, format: 'esm',
              platform: 'node', outfile: out, logLevel: 'silent' });
const { castRound } = await import(pathToFileURL(out).href);
const rng = Math.random;

const CHOICES = 5;

/** 嘘つきの流儀 */
const LIAR_STYLE = {
  // 適当な外れを名指しする
  scatter: (correct, seen) => { let x; do { x = Math.floor(rng()*CHOICES); } while (x === correct); return x; },
  // 嘘つき同士が同じ外れに寄せる（示し合わせた場合の上限）
  collude: (correct, seen) => seen.decoy,
};

/** 挑戦者の方針 */
const POLICY = {
  random: (votes) => Math.floor(rng() * CHOICES),
  // 一番多く名指しされたものを選ぶ
  plurality: (votes) => votes.indexOf(Math.max(...votes)),
};

function playRound(advisorCount, slots, liarStyle, policy) {
  const advisors = Array.from({ length: advisorCount }, (_, i) => ({ id: `a${i}`, name: `a${i}`, kind: 'human' }));
  const { speakerIds, liarIds } = castRound({ advisors, slots, mode: 'lottery', rng });
  const correct = Math.floor(rng() * CHOICES);

  // 嘘つきが結託する場合に寄せる先
  let decoy; do { decoy = Math.floor(rng()*CHOICES); } while (decoy === correct);
  const seen = { decoy };

  const votes = new Array(CHOICES).fill(0);
  for (const id of speakerIds) {
    const isLiar = liarIds.includes(id);
    votes[isLiar ? LIAR_STYLE[liarStyle](correct, seen) : correct] += 1;
  }
  const picked = policy(votes);
  return { survived: picked === correct, speakers: speakerIds.length, liars: liarIds.length };
}

function run(label, advisorCount, slots, liarStyle, policyName, trials = 20000) {
  let alive = 0, liarSum = 0, spkSum = 0;
  for (let i = 0; i < trials; i++) {
    const r = playRound(advisorCount, slots, liarStyle, POLICY[policyName]);
    if (r.survived) alive++;
    liarSum += r.liars; spkSum += r.speakers;
  }
  const pct = (alive / trials * 100);
  console.log(
    `${label.padEnd(28)} 発言枠${(spkSum/trials).toFixed(1).padStart(4)}人 ` +
    `嘘つき${(liarSum/trials).toFixed(1)}人  ${policyName.padEnd(9)} 生存率 ${pct.toFixed(1).padStart(5)}%`
  );
  return pct;
}

console.log('=== 5択・嘘つきは仕様どおり発言枠内に1〜2人 ===\n');
console.log('■ 挑戦者が当てずっぽうで選ぶ場合（助言を読まない）');
run('配信 1000人 / 枠5', 1000, 5, 'scatter', 'random');

console.log('\n■ 挑戦者が「一番多く名指しされたもの」を選ぶだけの場合');
for (const [label, n, s] of [
  ['友達4人 / 全員発言', 4, 5],
  ['友達7人 / 全員発言', 7, 8],
  ['配信 1000人 / 枠3', 1000, 3],
  ['配信 1000人 / 枠5', 1000, 5],
  ['配信 1000人 / 枠8', 1000, 8],
  ['配信 1000人 / 枠10', 1000, 10],
]) run(label, n, s, 'scatter', 'plurality');

console.log('\n■ 嘘つき同士が同じ外れに口裏を合わせた場合（嘘つき側の最善）');
for (const [label, n, s] of [
  ['友達4人 / 全員発言', 4, 5],
  ['配信 1000人 / 枠5', 1000, 5],
  ['配信 1000人 / 枠10', 1000, 10],
]) run(label, n, s, 'collude', 'plurality');
