/**
 * 嘘つきを多めに配り、各自が毎回は嘘をつかない形。
 *
 * ねらい：
 *  - 実際に嘘が出る人数が部屋ごとに変わる（0人の部屋も、4人の部屋もある）
 *  - 誰が嘘つきかは区画のあいだ変わらないので、記録が効く
 *  - 「ずっと本当を言って、ここぞで裏切る」がそのまま仕組みになる
 *  - 記録は役ではなく**振る舞い**で付ける（挑戦者に見えるのは結果だけ）
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];
const N = 6, M = 8, ROOMS = 6;

function section(liarFrac, lieRate, policy, stats) {
  const nLiars = Math.round(M * liarFrac);
  const liars = new Set();
  while (liars.size < nLiars) liars.add(Math.floor(rng() * M));
  const rec = new Map();
  let alive = 0;

  for (let r = 0; r < ROOMS; r++) {
    const correct = 0;
    const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
    const says = [], lying = [];
    for (let i = 0; i < M; i++) {
      const lies = liars.has(i) && rng() < lieRate;
      lying.push(lies);
      says.push(lies ? [pick(wrong)] : [correct, pick(wrong)]);
    }
    if (stats) {
      const counts = new Array(N).fill(0);
      for (const set of says) for (const c of set) counts[c]++;
      const sorted = [...counts].sort((a, b) => b - a);
      const gap = sorted[0] - sorted[1];
      stats.total++;
      if (gap >= 2) { stats.runaway++; if (counts[correct] === sorted[0]) stats.runawayHit++; }
      else if (gap === 1) stats.close++; else stats.tie++;
      stats.liarsActive += lying.filter(Boolean).length;
    }
    if (policy(says, rec, N, M) === correct) alive++;
    // 記録は振る舞いで付ける。正解に触れていれば「正」、触れていなければ「嘘」
    for (let i = 0; i < M; i++) {
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      says[i].includes(correct) ? x.hit++ : x.miss++;
      rec.set(i, x);
    }
  }
  return alive / ROOMS;
}

const POLICIES = {
  '数えるだけ': (says, _r, n) => {
    const s = new Array(n).fill(0);
    for (const set of says) for (const c of set) s[c]++;
    const m = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === m));
  },
  '記録で重み付け': (says, rec, n, m) => {
    const s = new Array(n).fill(0);
    for (let i = 0; i < m; i++) {
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      const w = (x.hit + 1) / (x.hit + x.miss + 2);
      for (const c of says[i]) s[c] += w;
    }
    const mx = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === mx));
  },
};

console.log(`${N}択 発言${M}人 区画${ROOMS}部屋。嘘つきは区画のあいだ固定、毎回は嘘をつかない\n`);
console.log('嘘つき割合  嘘をつく率   実際に嘘が出る人数  数えるだけ  記録で重み付け  腕の差  独走率  独走時的中');
for (const frac of [0.25, 0.375, 0.5, 0.625]) {
  for (const rate of [0.4, 0.6, 0.8]) {
    const T = 12000;
    let a = 0, b = 0;
    const stats = { total: 0, runaway: 0, runawayHit: 0, close: 0, tie: 0, liarsActive: 0 };
    for (let t = 0; t < T; t++) a += section(frac, rate, POLICIES['数えるだけ'], stats);
    for (let t = 0; t < T; t++) b += section(frac, rate, POLICIES['記録で重み付け'], null);
    const A = a / T * 100, B = b / T * 100;
    const ok = B >= 72 && B <= 88 && B - A >= 5 && stats.runaway / stats.total < 0.5 ? ' ★' : '';
    console.log(
      `${(frac * M).toFixed(0)}人/${M}人      ${(rate * 100).toFixed(0)}%        ` +
      `${(stats.liarsActive / stats.total).toFixed(1)}人           ` +
      `${A.toFixed(1)}%      ${B.toFixed(1)}%     +${(B - A).toFixed(1)}pt   ` +
      `${(stats.runaway / stats.total * 100).toFixed(0)}%    ${(stats.runawayHit / stats.runaway * 100).toFixed(0)}%${ok}`
    );
  }
}
