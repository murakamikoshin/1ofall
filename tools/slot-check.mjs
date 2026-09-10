/**
 * 発言枠へ上がる道が本当に通っているかを見る。
 *
 * 配信で視聴者が1000人いても発言できるのは8人。
 * 残りに渡してある手は二つ（枠外の賭けと立候補）だが、
 * **立候補は既定の抽選で一切見られていなかった**（指名方式のときだけ見ていた）。
 * 押しても何も起きないボタンだったので、ここで固定する。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `slot-${process.pid}-${Date.now()}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/casting';
    export * from './src/core/socket-gateway';
    export * from './src/core/rng';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

/* ── 重み付きの抽選 ─────────────────────────────────────────── */
{
  const advisors = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, name: `名${i}`, kind: 'human' }));
  const heavy = new Set(['a0', 'a1', 'a2']);
  const rng = C.createRng(4242);
  let heavyPicked = 0, flatPicked = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const weighted = C.castSpeakers({
      advisors, slots: 8, mode: 'lottery', rng,
      weight: (id) => (heavy.has(id) ? 4 : 1),
    });
    heavyPicked += weighted.filter((id) => heavy.has(id)).length;
    const flat = C.castSpeakers({ advisors, slots: 8, mode: 'lottery', rng });
    flatPicked += flat.filter((id) => heavy.has(id)).length;
  }
  const wRate = heavyPicked / (N * 3), fRate = flatPicked / (N * 3);
  console.log(`  手を挙げた3人が選ばれた率  重みあり ${(wRate * 100).toFixed(1)}%  重みなし ${(fRate * 100).toFixed(1)}%`);
  check('重みを付けると厚く引かれる', wRate > fRate * 1.8, `${wRate.toFixed(3)} vs ${fRate.toFixed(3)}`);
  // 確定枠にしていないこと。手を挙げていない人にも席が回る
  const rng2 = C.createRng(7);
  const one = C.castSpeakers({
    advisors, slots: 8, mode: 'lottery', rng: rng2,
    weight: (id) => (heavy.has(id) ? 4 : 1),
  });
  check('挙げていない人にも席が回る', one.filter((id) => !heavy.has(id)).length >= 4, one.join(','));
  check('枠の数はそのまま', one.length === 8 && new Set(one).size === 8, one.join(','));
}

/* ── 立候補と賭けが重みになる ─────────────────────────────── */
{
  const g = new C.SocketAdvisorGateway();
  for (let i = 0; i < 5; i++) g.join(`p${i}`, `名${i}`, `仮${i}`);
  const briefing = (roundId, roomInSection) => ({
    roundId, room: { id: 'r', theme: 't', prompt: { ja: '', en: '' }, choices: [], correct: 'x', deathMessage: { ja: '', en: '' } },
    casting: { speakerIds: [], liarIds: [] }, knowledge: new Map(), deadlineAt: 0,
    roomInSection, roomsPerSection: 5,
  });

  g.openRound(briefing('r1', 0));
  check('挙げる前は普通の重み', g.slotWeight('p0') === 1, `${g.slotWeight('p0')}`);
  g.volunteer('p0', 'r1');
  check('挙げると厚くなる', g.slotWeight('p0') === 4, `${g.slotWeight('p0')}`);

  // 区画のあいだは持ち越す。毎部屋消すと直前の部屋で挙げた人しか拾えない
  g.openRound(briefing('r2', 1));
  check('区画のあいだ挙げたままになる', g.slotWeight('p0') === 4, `${g.slotWeight('p0')}`);
  check('挙げた人の一覧に残る', g.volunteers().includes('p0'));

  // 区画が変わると切れる
  g.openRound(briefing('r3', 0));
  check('区画が変わると切れる', g.slotWeight('p0') === 1, `${g.slotWeight('p0')}`);

  // 枠外の賭けを当てていると少し厚くなる（上限あり）
  for (let i = 0; i < 3; i++) g.countVote('p1', true);
  check('賭けを当てていると厚くなる', Math.abs(g.slotWeight('p1') - 1.45) < 0.001, `${g.slotWeight('p1')}`);
  for (let i = 0; i < 30; i++) g.countVote('p1', true);
  check('厚さに上限がある', g.slotWeight('p1') === 2, `${g.slotWeight('p1')}`);
  g.dispose();
}

console.log(`\n${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
