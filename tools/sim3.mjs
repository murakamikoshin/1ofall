/**
 * 嘘つきが「毎回は嘘をつかない」場合。
 * 常に嘘をつく嘘つきは1部屋で割れる。信用を積んでから裏切れるかどうかが
 * 読み合いの本体のはずなので、そこを数字で見る。
 */
const rng = Math.random;
const CHOICES = 5, SECTION = 5;

function run(S, liarDist, lieRate, persist, runs = 12000) {
  let alive = 0, total = 0;
  const byRoom = Array.from({ length: SECTION }, () => ({ a: 0, t: 0 }));

  for (let r = 0; r < runs; r++) {
    let liars = pick(S, liarDist);
    const trust = new Array(S).fill(0);

    for (let room = 0; room < SECTION; room++) {
      if (!persist) liars = pick(S, liarDist);
      const correct = Math.floor(rng() * CHOICES);
      let decoy; do { decoy = Math.floor(rng() * CHOICES); } while (decoy === correct);

      const said = [];
      for (let i = 0; i < S; i++) {
        // 嘘つきも、信用を保つために本当のことを言う回がある
        const lying = liars.has(i) && rng() < lieRate;
        said.push(lying ? decoy : correct);
      }

      const v = new Array(CHOICES).fill(0);
      for (let i = 0; i < S; i++) v[said[i]] += Math.max(0.05, 1 + trust[i] * 0.6);
      const picked = v.indexOf(Math.max(...v));

      const ok = picked === correct;
      total++; if (ok) alive++;
      byRoom[room].t++; if (ok) byRoom[room].a++;
      for (let i = 0; i < S; i++) trust[i] += said[i] === correct ? 1 : -1.5;
    }
  }
  return {
    pct: alive / total * 100,
    curve: byRoom.map((b) => (b.a / b.t * 100).toFixed(0) + '%').join(' → '),
  };
}

function pick(S, dist) {
  const r = rng(); let acc = 0, count = 0;
  for (let k = 0; k < dist.length; k++) { acc += dist[k]; if (r <= acc) { count = k; break; } }
  const set = new Set();
  while (set.size < Math.min(count, S)) set.add(Math.floor(rng() * S));
  return set;
}

const S = 5;
const DIST = {
  '現状（必ず1〜2人）':  [0, 0.55, 0.45, 0, 0, 0],
  '0〜3人に散らす':      [0.25, 0.25, 0.25, 0.25, 0, 0],
  '0〜4人に散らす':      [0.15, 0.25, 0.25, 0.25, 0.10, 0],
};

console.log('挑戦者は「信用で重みをつけた多数決」を使う（人間がやる最善に近い）');
console.log('区画のあいだ嘘つきの役は固定。lie率＝嘘つきが実際に嘘をつく割合\n');
console.log('嘘つきの人数         lie率   生存率   区画内の推移');
for (const [label, dist] of Object.entries(DIST)) {
  for (const lie of [1.0, 0.7, 0.5, 0.35]) {
    const { pct, curve } = run(S, dist, lie, true);
    const star = pct >= 72 && pct <= 85 ? ' ★' : '';
    console.log(`${label.padEnd(20)} ${(lie*100).toFixed(0).padStart(3)}%  ${pct.toFixed(1).padStart(5)}%   ${curve}${star}`);
  }
  console.log('');
}

console.log('=== 配信での参加体験（発言枠5・20部屋の配信1回）===');
for (const viewers of [50, 200, 1000, 3000]) {
  const perRound = 5 / viewers;
  const everSpeak = 1 - Math.pow(1 - perRound, 20);
  const liarPerRound = 1.4 / viewers;
  const everLiar = 1 - Math.pow(1 - liarPerRound, 20);
  console.log(
    `視聴者${String(viewers).padStart(5)}人  1回でも発言できる確率 ${(everSpeak*100).toFixed(1).padStart(5)}%` +
    `  1回でも嘘つきになれる確率 ${(everLiar*100).toFixed(1).padStart(5)}%`
  );
}
