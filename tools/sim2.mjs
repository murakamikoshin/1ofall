/**
 * 直し方を数字で探す。
 *
 * 判明した問題：嘘つきが発言枠の過半に届かない限り、挑戦者は
 * 「一番多く名指しされたもの」を選ぶだけで100%生き残る。
 * ここでは嘘つきの人数分布と役の持続を変えて、生存率がどう動くかを見る。
 */
const rng = Math.random;
const CHOICES = 5;
const SECTION = 5;          // 区画の部屋数
const TARGET = [0.72, 0.85]; // 狙いたい1部屋あたりの生存率

function sectionRun(S, liarDist, persist, policy) {
  // 区画のあいだ役を固定するか、部屋ごとに引き直すか
  let liars = pickLiars(S, liarDist);
  const trust = new Array(S).fill(0); // 挑戦者が積む各人の信用
  const results = [];

  for (let room = 0; room < SECTION; room++) {
    if (!persist) liars = pickLiars(S, liarDist);

    const correct = Math.floor(rng() * CHOICES);
    let decoy; do { decoy = Math.floor(rng() * CHOICES); } while (decoy === correct);

    const said = [];
    for (let i = 0; i < S; i++) said.push(liars.has(i) ? decoy : correct);

    const picked = policy(said, trust, S);
    const survived = picked === correct;
    results.push({ room, survived, liars: liars.size });

    // 結果を見て信用を更新する（正解が開示されるので誰が嘘をついたか分かる）
    for (let i = 0; i < S; i++) trust[i] += said[i] === correct ? 1 : -1.5;
  }
  return results;
}

function pickLiars(S, dist) {
  const r = rng();
  let acc = 0, count = 0;
  for (let k = 0; k < dist.length; k++) { acc += dist[k]; if (r <= acc) { count = k; break; } }
  const set = new Set();
  while (set.size < Math.min(count, S)) set.add(Math.floor(rng() * S));
  return set;
}

const plurality = (said) => {
  const v = new Array(CHOICES).fill(0);
  for (const s of said) v[s]++;
  return v.indexOf(Math.max(...v));
};

// 各人の信用で重みをつけて数える
const weighted = (said, trust, S) => {
  const v = new Array(CHOICES).fill(0);
  for (let i = 0; i < S; i++) v[said[i]] += Math.max(0.05, 1 + trust[i] * 0.6);
  return v.indexOf(Math.max(...v));
};

function evaluate(label, S, dist, persist, policy, policyName, runs = 8000) {
  let alive = 0, total = 0;
  const byRoom = Array.from({ length: SECTION }, () => ({ a: 0, t: 0 }));
  for (let i = 0; i < runs; i++) {
    for (const r of sectionRun(S, dist, persist, policy)) {
      total++; if (r.survived) alive++;
      byRoom[r.room].t++; if (r.survived) byRoom[r.room].a++;
    }
  }
  const pct = alive / total;
  const curve = byRoom.map((b) => (b.a / b.t * 100).toFixed(0) + '%').join(' → ');
  const ok = pct >= TARGET[0] && pct <= TARGET[1] ? ' ★' : '';
  console.log(`${label.padEnd(34)} ${policyName.padEnd(6)} 生存率 ${(pct*100).toFixed(1).padStart(5)}%  区画内 ${curve}${ok}`);
  return pct;
}

const S = 5;
console.log('発言枠5人・5択・区画5部屋。★ は狙い（72〜85%）に入ったもの\n');

console.log('■ 現状の仕様（嘘つきは必ず1〜2人・毎部屋引き直し）');
evaluate('嘘つき 1〜2人', S, [0, 0.55, 0.45, 0, 0, 0], false, plurality, '多数決');
evaluate('嘘つき 1〜2人', S, [0, 0.55, 0.45, 0, 0, 0], false, weighted, '信用');

console.log('\n■ 直し方1：嘘つきの人数を散らす（0人の部屋も、過半の部屋もある）');
for (const [label, dist] of [
  ['0-3人 均等',            [0.25, 0.25, 0.25, 0.25, 0, 0]],
  ['0-4人 山なり',          [0.15, 0.25, 0.25, 0.25, 0.10, 0]],
  ['0-5人 広め',            [0.12, 0.20, 0.22, 0.22, 0.16, 0.08]],
  ['過半が出やすい',         [0.10, 0.15, 0.20, 0.30, 0.20, 0.05]],
]) evaluate(label, S, dist, false, plurality, '多数決');

console.log('\n■ 直し方2：直し方1 ＋ 区画のあいだ役を固定（信用が積める）');
for (const [label, dist] of [
  ['0-3人 均等',            [0.25, 0.25, 0.25, 0.25, 0, 0]],
  ['0-4人 山なり',          [0.15, 0.25, 0.25, 0.25, 0.10, 0]],
  ['0-5人 広め',            [0.12, 0.20, 0.22, 0.22, 0.16, 0.08]],
]) {
  evaluate(label, S, dist, true, plurality, '多数決');
  evaluate(label, S, dist, true, weighted, '信用');
}
