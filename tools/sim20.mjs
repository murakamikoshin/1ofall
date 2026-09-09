/**
 * どう直せば「数えるだけ」を超えられるかを、候補ごとに測る。
 *
 * 分かっていること：正直者が嘘つきより多い限り、
 * どんな形の主張でも「多数と整合する選択肢」を選べば当たる。
 * つまり嘘つきが過半に届き得ないと、腕の差は生まれない。
 *
 * だから候補は「嘘つきの人数を毎回変え、過半もあり得る」形になる。
 * このとき初めて「誰が嘘つきか」の情報に価値が出るはず。
 * 記録（区画のあいだ積まれる正n嘘n）がその情報源になる。
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

const N = 6;          // 選択肢
const M = 8;          // 発言者
const ROOMS = 6;      // 区画の部屋数

/** 嘘つきの人数の決め方 */
const LIARS = {
  '固定2人（いまの形）': () => 2,
  '0〜3人': () => Math.floor(rng() * 4),
  '0〜5人（過半あり）': () => Math.floor(rng() * 6),
  '0〜7人（全員嘘もあり）': () => Math.floor(rng() * 8),
};

function playSection(liarCount, policy) {
  // 配役は区画のあいだ固定（記録が意味を持つ）
  const liars = new Set();
  const n = liarCount();
  while (liars.size < Math.min(n, M - 1)) liars.add(Math.floor(rng() * M));
  const rec = new Map();
  let alive = 0;

  for (let r = 0; r < ROOMS; r++) {
    const correct = 0;
    const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
    // 協力者は正解を含む二択、嘘つきは外れを押す（いまの形と同じ）
    const says = [];
    for (let i = 0; i < M; i++) {
      says.push(liars.has(i) ? [pick(wrong)] : [correct, pick(wrong)]);
    }
    const choice = policy(says, rec, N, M);
    if (choice === correct) alive++;
    for (let i = 0; i < M; i++) {
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      liars.has(i) ? x.miss++ : x.hit++;
      rec.set(i, x);
    }
  }
  return alive / ROOMS;
}

const POLICIES = {
  '当てずっぽう': (_s, _r, n) => Math.floor(rng() * n),
  '数えるだけ': (says, _rec, n) => {
    const s = new Array(n).fill(0);
    for (const set of says) for (const c of set) s[c]++;
    const max = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === max));
  },
  '記録を使う（信じた相手だけ数える）': (says, rec, n, m) => {
    const s = new Array(n).fill(0);
    for (let i = 0; i < m; i++) {
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      const seen = x.hit + x.miss;
      // 一度でも嘘が見えた相手は切る。まだ見ていない相手は薄く数える
      const w = seen === 0 ? 0.5 : x.miss > 0 ? 0 : 1;
      for (const c of says[i]) s[c] += w;
    }
    const max = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === max));
  },
};

console.log(`${N}択 発言${M}人 区画${ROOMS}部屋。配役は区画のあいだ固定\n`);
const names = Object.keys(POLICIES);
console.log('嘘つきの人数'.padEnd(26) + names.map((n) => n.slice(0, 14).padStart(16)).join('') + '   腕の差');
for (const [label, gen] of Object.entries(LIARS)) {
  const out = [];
  for (const n of names) {
    let s = 0;
    const T = 20000;
    for (let t = 0; t < T; t++) s += playSection(gen, POLICIES[n]);
    out.push(s / T * 100);
  }
  const gap = out[2] - out[1];
  const ok = out[2] >= 70 && out[2] <= 88 && gap >= 8 ? ' ★' : '';
  console.log(label.padEnd(24) + out.map((v) => `${v.toFixed(1)}%`.padStart(16)).join('') + `  ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}pt${ok}`);
}
