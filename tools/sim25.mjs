/**
 * 「嘘つきが一度も死なない」問題を潰す。
 *
 * 案：嘘つきは**どれが死ぬかを知っていて、どれが正解かは知らない**。
 *   - 死を避けられるので、自分から罠に落ちることはない
 *   - しかし正解は知らないので、他の人と同じく当てずっぽうが混じる＝時々死ぬ
 *   - 罠へ誘えるのは変わらない（どれが死ぬかを知っているから）
 *
 * 比べる：
 *   A 嘘つきは正解を知る（絶対に死なない）
 *   B 嘘つきは死ぬ選択肢だけ知る（時々死ぬ）
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

function play({ N, P, L, ownSize, liarKnowsAnswer }, rooms = 8) {
  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * P));
  const rec = new Map();
  const deaths = new Array(P).fill(0);
  let honestAlive = 0, honestRooms = 0;

  for (let r = 0; r < rooms; r++) {
    const correct = 0;
    const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
    const trap = pick(wrong);

    const own = [], says = [];
    for (let i = 0; i < P; i++) {
      if (liars.has(i)) {
        // 罠へ誘う。たまに本当のことを言って信用を作る
        says.push(rng() < 0.75 ? [trap] : [correct]);
        own.push(liarKnowsAnswer ? [correct] : null);   // null＝正解は知らない
      } else {
        const pool = wrong.slice(); const set = [correct];
        for (let k = 0; k < ownSize - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        own.push(set);
        says.push(rng() < 0.5 ? set : [pick(set)]);
      }
    }

    // 全員が選ぶ
    for (let i = 0; i < P; i++) {
      let choice;
      if (liars.has(i)) {
        if (liarKnowsAnswer) choice = correct;
        else {
          // 罠だけは避けられる。あとは他人の話と勘で選ぶ
          const s = new Array(N).fill(0);
          for (let j = 0; j < P; j++) if (j !== i) for (const c of says[j]) s[c]++;
          s[trap] = -99;
          const m = Math.max(...s);
          choice = pick([...s.keys()].filter((k) => s[k] === m));
        }
      } else {
        const s = new Array(N).fill(0);
        for (const c of own[i]) s[c] += 2.5;
        for (let j = 0; j < P; j++) {
          if (j === i) continue;
          const x = rec.get(j) ?? { hit: 0, miss: 0 };
          const w = (x.hit + 1) / (x.hit + x.miss + 2) * 2;
          for (const c of says[j]) s[c] += w;
        }
        const m = Math.max(...s);
        choice = pick([...s.keys()].filter((k) => s[k] === m));
        honestRooms++;
        if (choice === correct) honestAlive++;
      }
      if (choice !== correct) deaths[i]++;
    }

    for (let i = 0; i < P; i++) {
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      says[i].includes(correct) ? x.hit++ : x.miss++;
      rec.set(i, x);
    }
  }

  const liarDeaths = [...liars].reduce((a, i) => a + deaths[i], 0) / L;
  const honestDeaths = deaths.reduce((a, d, i) => a + (liars.has(i) ? 0 : d), 0) / (P - L);
  return { survival: honestAlive / honestRooms * 100, liarDeaths, honestDeaths };
}

console.log('嘘つきの死亡回数が正直者と比べてどうか（8部屋あたり）\n');
console.log('形                        正直者の生存率  正直者の死亡  嘘つきの死亡  見分けやすさ');
for (const [label, liarKnowsAnswer] of [['A 嘘つきは正解を知る', true], ['B 嘘つきは死ぬ方だけ知る', false]]) {
  for (const [P, L, ownSize] of [[6, 2, 3], [8, 3, 3]]) {
    let s = 0, ld = 0, hd = 0; const T = 8000;
    for (let t = 0; t < T; t++) {
      const r = play({ N: 6, P, L, ownSize, liarKnowsAnswer });
      s += r.survival; ld += r.liarDeaths; hd += r.honestDeaths;
    }
    const gap = hd / T - ld / T;
    console.log(
      `${label} ${P}人      ${(s / T).toFixed(1).padStart(5)}%       ${(hd / T).toFixed(2)}回      ` +
      `${(ld / T).toFixed(2)}回      ${gap > 1.2 ? '丸わかり' : gap > 0.6 ? 'やや見える' : '見分けにくい'}（差${gap.toFixed(2)}）`
    );
  }
}
