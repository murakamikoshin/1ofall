/**
 * 区画のあいだ発言者と嘘つきを固定し、
 * 「助言を開いた相手だけ、あとで正体が分かる」形にした場合。
 *
 * 7人のうち2人が嘘つき。1部屋で3通しか開けないので、正体は少しずつしか割れない。
 * 割れた分だけ次の部屋が楽になる＝区画の中に学習の弧ができるはず。
 */
const rng = Math.random;
const shuffle = (a) => a.slice().sort(() => rng() - 0.5);

function section({ rooms, C, S, L, K, persist }) {
  let liars = drawLiars(S, L);
  const known = new Map();           // id → 嘘をついたのを見た回数 / 正しかった回数
  const out = [];

  for (let r = 0; r < rooms; r++) {
    if (!persist) liars = drawLiars(S, L);

    const said = [];
    for (let i = 0; i < S; i++) said.push(liars.has(i) ? 1 + Math.floor(rng() * (C - 1)) : 0);

    // 開く相手を選ぶ：嘘つきと分かっている者を避け、当たった者を優先する
    const ranked = shuffle([...Array(S).keys()]).sort((a, b) => score(known, b) - score(known, a));
    const opened = ranked.slice(0, K);

    const v = new Array(C).fill(0);
    for (const i of opened) v[said[i]]++;
    const max = Math.max(...v);
    const top = v.reduce((a, x, i) => (x === max ? [...a, i] : a), []);
    const pick = top[Math.floor(rng() * top.length)];
    const survived = pick === 0;
    out.push(survived);

    // 結果が出れば、開いた相手が嘘をついたかどうかは分かる
    for (const i of opened) {
      const rec = known.get(i) ?? { good: 0, bad: 0 };
      if (said[i] === 0) rec.good++; else rec.bad++;
      known.set(i, rec);
    }
  }
  return out;
}

const score = (known, i) => {
  const r = known.get(i);
  if (!r) return 0;
  return r.good - r.bad * 3;   // 一度でも嘘が見えたら強く避ける
};

function drawLiars(S, L) {
  const s = new Set();
  while (s.size < Math.min(L, S)) s.add(Math.floor(rng() * S));
  return s;
}

function evaluate(label, cfg, trials = 40000) {
  const byRoom = Array.from({ length: cfg.rooms }, () => 0);
  let all = 0;
  for (let t = 0; t < trials; t++) {
    const res = section(cfg);
    res.forEach((ok, i) => { if (ok) { byRoom[i]++; all++; } });
  }
  const curve = byRoom.map((c) => (c / trials * 100).toFixed(0) + '%').join(' → ');
  console.log(`${label.padEnd(26)} 平均 ${(all/(trials*cfg.rooms)*100).toFixed(1).padStart(5)}%   ${curve}`);
}

console.log('区画6部屋・5択・発言7人・嘘つき2人・3通開封\n');
console.log('配役の引き方                    平均生存率   区画内の推移');
evaluate('毎部屋 引き直し（現仕様）', { rooms: 6, C: 5, S: 7, L: 2, K: 3, persist: false });
evaluate('区画のあいだ固定',        { rooms: 6, C: 5, S: 7, L: 2, K: 3, persist: true });

console.log('\n発言枠を区画ごとに狭める場合（固定配役）');
for (const S of [8, 7, 6, 5]) {
  evaluate(`発言${S}人`, { rooms: 6, C: 5, S, L: 2, K: 3, persist: true });
}

console.log('\n■ 1周の長さ（区画6部屋 × 4区画 = 24部屋 / 命3 / 1部屋40秒）');
function run(lives, sections, roomsPer, slotsBySection) {
  let attempts = 0, sec = 0, livesLeft = lives;
  while (livesLeft > 0 && sec < sections) {
    const S = slotsBySection[sec];
    const res = section({ rooms: roomsPer, C: 5, S, L: 2, K: 3, persist: true });
    let cleared = 0;
    for (const ok of res) {
      attempts++;
      if (ok) cleared++; else { livesLeft--; break; }
    }
    if (cleared === roomsPer) sec++;
    if (livesLeft <= 0) break;
  }
  return { attempts, sec };
}
let att = 0, depth = 0, win = 0;
const N = 40000;
for (let i = 0; i < N; i++) {
  const r = run(3, 4, 6, [8, 7, 6, 5]);
  att += r.attempts; depth += r.sec; if (r.sec >= 4) win++;
}
console.log(`挑戦した部屋 平均 ${(att/N).toFixed(1)} / 抜けた区画 平均 ${(depth/N).toFixed(2)} / 全踏破 ${(win/N*100).toFixed(0)}%`);
console.log(`1周 約 ${((att/N)*40/60).toFixed(1)} 分`);
