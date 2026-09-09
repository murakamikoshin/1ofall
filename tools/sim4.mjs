/**
 * 嘘つきは互いに示し合わせられるのか。
 * 現状の設計では、嘘つきは他の嘘つきが誰かを知らず、他人のヒントも見えない。
 * つまり嘘がばらける。ばらけた嘘は多数決で消える。
 * 「示し合わせられるかどうか」で強さがどれだけ変わるかを見る。
 */
const rng = Math.random;
const CHOICES = 5;

function trial(S, L, coordinated) {
  const correct = 0;
  const votes = new Array(CHOICES).fill(0);
  const H = S - L;
  votes[correct] += H;

  if (coordinated) {
    // 嘘つき全員が同じ外れに寄せる
    const decoy = 1 + Math.floor(rng() * (CHOICES - 1));
    votes[decoy] += L;
  } else {
    // 各自ばらばらに外れを選ぶ
    for (let i = 0; i < L; i++) votes[1 + Math.floor(rng() * (CHOICES - 1))] += 1;
  }

  const max = Math.max(...votes);
  const tied = votes.reduce((a, v, i) => (v === max ? [...a, i] : a), []);
  // 同点なら挑戦者はその中から選ぶしかない
  return tied[Math.floor(rng() * tied.length)] === correct;
}

function pct(S, L, coordinated, n = 60000) {
  let a = 0;
  for (let i = 0; i < n; i++) if (trial(S, L, coordinated)) a++;
  return (a / n * 100);
}

console.log('5択。挑戦者は素直に多数決。数字は挑戦者の生存率\n');
console.log('発言枠  嘘つき   ばらばらに嘘   示し合わせて嘘   差');
for (const S of [3, 5, 8, 10]) {
  for (let L = 1; L < S; L++) {
    const scattered = pct(S, L, false);
    const colluded = pct(S, L, true);
    const mark = L / S > 0.5 ? ' ←嘘つきが過半' : '';
    console.log(
      `${String(S).padStart(4)}人 ${String(L).padStart(4)}人  ` +
      `${scattered.toFixed(1).padStart(9)}%  ${colluded.toFixed(1).padStart(11)}%  ` +
      `${(scattered - colluded).toFixed(1).padStart(6)}pt${mark}`
    );
  }
  console.log('');
}
