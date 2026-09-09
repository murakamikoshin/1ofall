/**
 * 1. 区画ごとの難度の階段を決める
 * 2. 「ずっと本当を言って最後に裏切る」が成立するか（区画のあいだ役を固定した場合）
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

function playRoom({ N, M, L, C }, liarSet, trust) {
  const correct = 0;
  const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const push = new Array(N).fill(0);
  const hedge = new Array(N).fill(0);
  const acted = [];   // 誰がどこに票を入れたか（あとで信用を更新する）

  for (let i = 0; i < M; i++) {
    const w = trust ? Math.max(0.05, 1 + (trust.get(i) ?? 0) * 0.5) : 1;
    if (liarSet.has(i)) {
      // 嘘つきは「押す」か「本当のことを言って信用を作る」かを選べる
      if (trust && rng() < 0.35) {
        // 信用作り：正解を含む候補を出す（本当のことを言う）
        const set = [correct, pick(wrong)];
        for (const s of set) hedge[s] += w;
        acted.push({ i, honestLooking: true });
      } else {
        push[pick(wrong)] += w;
        acted.push({ i, honestLooking: false });
      }
    } else {
      const pool = wrong.slice();
      const set = [correct];
      for (let k = 0; k < C - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      if (rng() < 0.5) { push[pick(set)] += w; acted.push({ i, honestLooking: true }); }
      else { for (const s of set) hedge[s] += w; acted.push({ i, honestLooking: true }); }
    }
  }

  const score = [...Array(N).keys()].map((i) => push[i] + hedge[i] * 0.7);
  const max = Math.max(...score);
  const chosen = pick([...Array(N).keys()].filter((i) => score[i] === max));
  return { survived: chosen === correct, acted, correct, push, hedge };
}

function drawLiars(M, L) {
  const s = new Set();
  while (s.size < L) s.add(Math.floor(rng() * M));
  return s;
}

function section(cfg, rooms, persist) {
  const trust = persist ? new Map() : null;
  let liars = drawLiars(cfg.M, cfg.L);
  const out = [];
  for (let r = 0; r < rooms; r++) {
    if (!persist) liars = drawLiars(cfg.M, cfg.L);
    const res = playRoom(cfg, liars, trust);
    out.push(res.survived);
    if (trust) {
      // 結果を見て信用を更新する。正解に触れていた人を信じ、外れを押した人を疑う
      for (let i = 0; i < cfg.M; i++) {
        const helped = res.push[res.correct] > 0 || res.hedge[res.correct] > 0;
        void helped;
      }
      for (const a of res.acted) trust.set(a.i, (trust.get(a.i) ?? 0) + (a.honestLooking ? 0.4 : -0.8));
    }
  }
  return out;
}

function evaluate(label, cfg, rooms, persist, trials = 20000) {
  const byRoom = new Array(rooms).fill(0);
  let all = 0;
  for (let t = 0; t < trials; t++) {
    section(cfg, rooms, persist).forEach((ok, i) => { if (ok) { byRoom[i]++; all++; } });
  }
  const curve = byRoom.map((c) => (c / trials * 100).toFixed(0) + '%').join(' → ');
  const avg = all / (trials * rooms) * 100;
  const star = avg >= 72 && avg <= 88 ? ' ★' : '';
  console.log(`${label.padEnd(30)} 平均 ${avg.toFixed(1).padStart(5)}%  ${curve}${star}`);
  return avg;
}

if (process.argv[2] === 'sweep') {
  console.log('区画のあいだ役を固定（＝裏切りが成立する形）。狙いは平均80%前後\n');
  console.log('発言 嘘 候補   平均生存率   区画内の推移');
  for (const M of [8, 7, 6, 5, 4]) {
    for (const L of [1, 2]) {
      for (const C of [2, 3]) {
        if (L >= M) continue;
        evaluate(`${M}人 嘘${L} 候補${C}択`, { N: 6, M, L, C }, 6, true, 12000);
      }
    }
  }
  process.exit(0);
}

console.log('■ 区画ごとの難度の階段（役は毎部屋引き直し）');
for (const [label, cfg] of [
  ['区画1  6択 8人 嘘1 候補2', { N: 6, M: 8, L: 1, C: 2 }],
  ['区画2  6択 8人 嘘2 候補2', { N: 6, M: 8, L: 2, C: 2 }],
  ['区画3  6択 6人 嘘2 候補2', { N: 6, M: 6, L: 2, C: 2 }],
  ['区画4  6択 6人 嘘2 候補3', { N: 6, M: 6, L: 2, C: 3 }],
  ['（参考）7択 8人 嘘2 候補2', { N: 7, M: 8, L: 2, C: 2 }],
  ['（参考）6択 5人 嘘1 候補2', { N: 6, M: 5, L: 1, C: 2 }],
  ['（参考）6択 4人 嘘1 候補2', { N: 6, M: 4, L: 1, C: 2 }],
]) evaluate(label, cfg, 6, false);

console.log('\n■ 区画のあいだ役を固定した場合（＝最後に裏切れる形）');
console.log('  嘘つきは35%の確率で本当のことを言って信用を作る');
for (const [label, cfg] of [
  ['6択 8人 嘘2 候補2', { N: 6, M: 8, L: 2, C: 2 }],
  ['6択 6人 嘘2 候補2', { N: 6, M: 6, L: 2, C: 2 }],
  ['6択 8人 嘘1 候補2', { N: 6, M: 8, L: 1, C: 2 }],
]) evaluate(label, cfg, 6, true);
