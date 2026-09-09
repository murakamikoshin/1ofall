/**
 * 案：協力者は正解を C 択まで絞れているが、どれかは分からない。
 *     嘘つきだけが正解を正確に知っている。
 *
 * 効くはずの理屈：
 *   - 正解は全協力者の候補に必ず入るので、票が自然に集まる
 *   - しかし各協力者は自分の候補の中で迷うので、票は割れる（多数決が決め手にならない）
 *   - 嘘つきは正確に知っているので、一点に力を集められる
 *   - 協力者は本当に自信が無い。嘘つきだけが断言できる ＝ 断言が手掛かりになる
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

function room({ N, M, L, C, liarFocus }) {
  const correct = 0;
  const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * M));

  const push = new Array(N).fill(0);
  const hedge = new Array(N).fill(0);   // 「AかB」と両方に触れた回数

  // 嘘つきが狙う先。互いを知らないのでばらける（liarFocus=false）か、
  // 盤面で一番それらしい外れに自然と寄る（liarFocus=true）
  const focus = pick(wrong);

  for (let i = 0; i < M; i++) {
    if (liars.has(i)) {
      push[liarFocus ? focus : pick(wrong)] += 1;
    } else {
      // 候補集合＝正解＋外れ(C-1)個
      const pool = wrong.slice();
      const set = [correct];
      for (let k = 0; k < C - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      // 半分は1つに賭けて言い、半分は「どっちか」と両方に触れる
      if (rng() < 0.5) push[pick(set)] += 1;
      else for (const s of set) hedge[s] += 1;
    }
  }
  return { correct, push, hedge, N };
}

const POLICY = {
  当てずっぽう: ({ N }) => Math.floor(rng() * N),
  票が多い順: ({ push, N }) => {
    const max = Math.max(...push);
    return pick([...Array(N).keys()].filter((i) => push[i] === max));
  },
  迷いも数える: ({ push, hedge, N }) => {
    const score = [...Array(N).keys()].map((i) => push[i] + hedge[i] * 0.7);
    const max = Math.max(...score);
    return pick([...Array(N).keys()].filter((i) => score[i] === max));
  },
};

function rate(cfg, policyName, n = 60000) {
  let a = 0;
  for (let i = 0; i < n; i++) {
    const r = room(cfg);
    if (POLICY[policyName](r) === r.correct) a++;
  }
  return a / n * 100;
}

console.log('協力者の候補数 C＝正解を何択まで絞れているか');
console.log('嘘つきは互いを知らないので狙いはばらける（focus=false）\n');
console.log('択 発言 嘘 候補   当てずっぽう  票が多い順  迷いも数える');
for (const [N, M, L, C] of [
  [5, 6, 1, 2], [5, 6, 2, 2], [5, 8, 2, 2], [5, 8, 2, 3],
  [6, 6, 1, 2], [6, 6, 2, 2], [6, 8, 2, 2], [6, 8, 2, 3], [6, 8, 1, 3],
  [7, 8, 2, 2], [7, 8, 2, 3], [6, 5, 1, 2], [6, 4, 1, 2], [6, 12, 2, 3],
]) {
  const cfg = { N, M, L, C, liarFocus: false };
  const r = (p) => rate(cfg, p).toFixed(1).padStart(5);
  const star = (() => { const v = parseFloat(rate(cfg, '迷いも数える')); return v >= 72 && v <= 88 ? ' ★' : ''; })();
  console.log(`${N}択 ${String(M).padStart(2)}人 ${L}人 ${C}択  ${r('当てずっぽう')}%      ${r('票が多い順')}%      ${r('迷いも数える')}%${star}`);
}

console.log('\n嘘つきが同じ外れに寄った場合（人間なら起きうる）');
for (const [N, M, L, C] of [[6, 8, 2, 2], [6, 8, 2, 3], [5, 8, 2, 2]]) {
  const cfg = { N, M, L, C, liarFocus: true };
  console.log(`${N}択 ${M}人 嘘${L}人 候補${C}択  票が多い順 ${rate(cfg, '票が多い順').toFixed(1)}%  迷いも数える ${rate(cfg, '迷いも数える').toFixed(1)}%`);
}
