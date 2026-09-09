/** 発言者数ごとに、開封数と嘘つき数の適正な組み合わせを探す */
const rng = Math.random;

function survive(C, S, L, K) {
  const liars = new Set();
  while (liars.size < Math.min(L, S)) liars.add(Math.floor(rng() * S));
  const said = [];
  for (let i = 0; i < S; i++) said.push(liars.has(i) ? 1 + Math.floor(rng() * (C - 1)) : 0);
  const order = [...Array(S).keys()].sort(() => rng() - 0.5).slice(0, Math.min(K, S));
  const v = new Array(C).fill(0);
  for (const i of order) v[said[i]]++;
  const max = Math.max(...v);
  const top = v.reduce((a, x, i) => (x === max ? [...a, i] : a), []);
  return top[Math.floor(rng() * top.length)] === 0;
}

function rate(C, S, L, K, n = 120000) {
  let a = 0;
  for (let i = 0; i < n; i++) if (survive(C, S, L, K)) a++;
  return a / n * 100;
}

console.log('5択。発言者Sのとき、嘘つきLと開封Kをどう組むと生存率が狙い（80〜90%）に入るか\n');
console.log('発言者  嘘つき  開封   生存率');
const good = [];
for (const S of [3, 4, 5, 6, 7, 8, 10]) {
  for (const L of [1, 2, 3]) {
    if (L >= S) continue;
    for (const K of [1, 2, 3, 4, 5]) {
      if (K > S) continue;
      const r = rate(5, S, L, K);
      const star = r >= 80 && r <= 90 ? ' ★' : '';
      if (star || (K <= 3 && L <= 2)) {
        console.log(`${String(S).padStart(4)}人 ${String(L).padStart(5)}人 ${String(K).padStart(4)}通  ${r.toFixed(1).padStart(5)}%${star}`);
        if (star) good.push([S, L, K, r]);
      }
    }
  }
  console.log('');
}
console.log('狙いに入った組み合わせ:', good.map(([S,L,K,r]) => `${S}人/嘘${L}/開${K}=${r.toFixed(0)}%`).join('  '));
