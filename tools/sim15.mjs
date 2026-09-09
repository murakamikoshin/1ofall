/**
 * 「助言者ごとに分かる情報が違う」と破綻するか。
 *
 * いまは全協力者が同じ形の知識を持つ（正解＋外れ1つの二択）。
 * 内容は人ごとに違うが、形は同じ。
 *
 * これを、形そのものが人ごとに違う状態にしたらどうなるかを測る。
 *   目利き   正解を二択まで絞れている
 *   半可通   正解を三択まで絞れている
 *   耳打ち   「これは死ぬ」を1つだけ知っている
 *   素人     何も知らない
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

const TIERS = ['narrow2', 'narrow3', 'deadly', 'blind'];

function room({ N, M, L, mix }) {
  const correct = 0;
  const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * M));

  const up = new Array(N).fill(0);     // 押された（断言）
  const soft = new Array(N).fill(0);   // 迷いを込めて触れられた
  const down = new Array(N).fill(0);   // 「やめろ」と否定された

  for (let i = 0; i < M; i++) {
    if (liars.has(i)) {
      // 嘘つきは正解を知っている。押すか、否定するか、信用を作るか
      const r = rng();
      if (r < 0.30) { for (const s of [correct, pick(wrong)]) soft[s]++; }  // 信用作り
      else if (r < 0.75) up[pick(wrong)]++;                                  // 外れを押す
      else down[correct]++;                                                  // 正解を潰す
      continue;
    }

    const tier = mix[Math.floor(rng() * mix.length)];
    if (tier === 'blind') {
      // 何も知らないので当てずっぽう。迷いの形で出す
      const guess = Math.floor(rng() * N);
      soft[guess]++;
      continue;
    }
    if (tier === 'deadly') {
      down[pick(wrong)]++;
      continue;
    }
    const size = tier === 'narrow2' ? 2 : 3;
    const pool = wrong.slice();
    const set = [correct];
    for (let k = 0; k < size - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    if (rng() < 0.5) { for (const s of set) soft[s]++; }
    else soft[pick(set)]++;
  }
  return { correct, up, soft, down, N };
}

const POLICY = {
  当てずっぽう: ({ N }) => Math.floor(rng() * N),
  素朴: ({ up, soft, down, N }) => {
    const sc = [...Array(N).keys()].map((i) => up[i] * 1.0 + soft[i] * 0.7 - down[i]);
    const max = Math.max(...sc);
    return pick([...Array(N).keys()].filter((i) => sc[i] === max));
  },
  設計どおり: ({ up, soft, down, N }) => {
    const sc = [...Array(N).keys()].map((i) => up[i] * 0.45 + soft[i] * 1.0 - down[i] * 0.9);
    const max = Math.max(...sc);
    return pick([...Array(N).keys()].filter((i) => sc[i] === max));
  },
};

function rate(cfg, policy, n = 60000) {
  let a = 0;
  for (let i = 0; i < n; i++) { const r = room(cfg); if (POLICY[policy](r) === r.correct) a++; }
  return a / n * 100;
}

const N = 6, M = 8, L = 2;
console.log(`${N}択 発言${M}人 嘘つき${L}人\n`);
console.log('助言者の内訳                          当てずっぽう  素朴   設計どおり  読みの差');
for (const [label, mix] of [
  ['いまの形（全員が二択）',            ['narrow2']],
  ['二択と三択が混ざる',                ['narrow2', 'narrow3']],
  ['二択・三択・耳打ち',                ['narrow2', 'narrow3', 'deadly']],
  ['四種すべて混ざる',                  TIERS],
  ['耳打ちだけ',                        ['deadly']],
  ['素人が半分',                        ['narrow2', 'blind']],
  ['素人が四分の一',                    ['narrow2', 'narrow2', 'narrow2', 'blind']],
  ['二択・三択・耳打ち（素人なし）',      ['narrow2', 'narrow2', 'narrow3', 'deadly']],
]) {
  const cfg = { N, M, L, mix };
  const r0 = rate(cfg, '当てずっぽう'), r1 = rate(cfg, '素朴'), r2 = rate(cfg, '設計どおり');
  const gap = r2 - r1;
  const ok = r2 >= 72 && r2 <= 90 && gap >= 6 ? ' ★' : '';
  console.log(`${label.padEnd(34)} ${r0.toFixed(1).padStart(5)}%  ${r1.toFixed(1).padStart(5)}%  ${r2.toFixed(1).padStart(6)}%  ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}pt${ok}`);
}
