/**
 * 全員挑戦者モードの検証。
 *
 * 形：N人全員が挑戦者。各自が部分的な情報を持ち、助言を出し合い、同時に選ぶ。
 * 嘘つきも挑戦者だが、正解を正確に知っているので自分は死なない。
 *
 * いちばん怖い壊れ方：
 *   自分の持っている情報だけで足りてしまうと、他人の話を聞く必要がなくなる。
 *   そうなると「情報をあげ合う」という看板が飾りになる。
 *   まずそこを測る。
 */
const rng = Math.random;
const pick = (a) => a[Math.floor(rng() * a.length)];

function room({ N, P, L, ownSize }) {
  const correct = 0;
  const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);
  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * P));

  // 罠は嘘つき共通
  const trap = pick(wrong);
  const own = [], says = [];
  for (let i = 0; i < P; i++) {
    if (liars.has(i)) {
      own.push([correct]);                       // 嘘つきは正確に知っている
      says.push(rng() < 0.75 ? [trap] : [correct]); // 罠へ誘う。たまに本当を言う
    } else {
      const pool = wrong.slice();
      const set = [correct];
      for (let k = 0; k < ownSize - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      own.push(set);
      says.push(rng() < 0.5 ? set : [pick(set)]);  // 迷いを見せるか、一つに賭けるか
    }
  }
  return { correct, own, says, liars, N, P };
}

/** 私は honest な i 番の人。いろいろな打ち方で選んでみる */
const PLAYERS = {
  '自分の情報だけ': ({ own }, me) => pick(own[me]),
  '他人の話だけ数える': ({ says, N, P }, me) => {
    const s = new Array(N).fill(0);
    for (let i = 0; i < P; i++) if (i !== me) for (const c of says[i]) s[c]++;
    const m = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === m));
  },
  '自分の情報＋他人を数える': ({ own, says, N, P }, me) => {
    const s = new Array(N).fill(0);
    for (const c of own[me]) s[c] += 2.5;          // 自分の情報は確実に正しい
    for (let i = 0; i < P; i++) if (i !== me) for (const c of says[i]) s[c]++;
    const m = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === m));
  },
  '自分の情報＋記録で重み付け': ({ own, says, N, P }, me, rec) => {
    const s = new Array(N).fill(0);
    for (const c of own[me]) s[c] += 2.5;
    for (let i = 0; i < P; i++) {
      if (i === me) continue;
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      const w = (x.hit + 1) / (x.hit + x.miss + 2) * 2;
      for (const c of says[i]) s[c] += w;
    }
    const m = Math.max(...s);
    return pick([...s.keys()].filter((i) => s[i] === m));
  },
};

function section(cfg, policy, rooms = 8) {
  const rec = new Map();
  let alive = 0, n = 0;
  // 配役は区画のあいだ固定
  const fixedLiars = new Set();
  while (fixedLiars.size < cfg.L) fixedLiars.add(Math.floor(rng() * cfg.P));

  for (let r = 0; r < rooms; r++) {
    const st = room({ ...cfg });
    st.liars = fixedLiars;
    // 配役を固定したので、言うことと持っている情報を作り直す
    const wrong = Array.from({ length: cfg.N - 1 }, (_, i) => i + 1);
    const trap = pick(wrong);
    st.own = []; st.says = [];
    for (let i = 0; i < cfg.P; i++) {
      if (fixedLiars.has(i)) {
        st.own.push([0]);
        st.says.push(rng() < 0.75 ? [trap] : [0]);
      } else {
        const pool = wrong.slice(); const set = [0];
        for (let k = 0; k < cfg.ownSize - 1 && pool.length; k++) set.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        st.own.push(set);
        st.says.push(rng() < 0.5 ? set : [pick(set)]);
      }
    }
    // 正直者の一人になりきって選ぶ
    const me = [...Array(cfg.P).keys()].find((i) => !fixedLiars.has(i));
    if (policy(st, me, rec) === 0) alive++;
    n++;
    for (let i = 0; i < cfg.P; i++) {
      if (i === me) continue;
      const x = rec.get(i) ?? { hit: 0, miss: 0 };
      st.says[i].includes(0) ? x.hit++ : x.miss++;
      rec.set(i, x);
    }
  }
  return alive / n;
}

console.log('全員挑戦者。P人中L人が嘘つき。各自の持ち情報は ownSize 択まで\n');
console.log('人数 嘘つき 持ち情報   自分だけ  他人だけ  自分+数える  自分+記録   他人の価値');
for (const [P, L, ownSize] of [[4, 1, 2], [5, 1, 2], [5, 2, 2], [6, 2, 2], [6, 2, 3], [8, 3, 3]]) {
  const cfg = { N: 6, P, L, ownSize };
  const out = {};
  for (const name of Object.keys(PLAYERS)) {
    let s = 0; const T = 20000;
    for (let t = 0; t < T; t++) s += section(cfg, PLAYERS[name]);
    out[name] = s / T * 100;
  }
  const value = out['自分の情報＋記録で重み付け'] - out['自分の情報だけ'];
  const ok = value >= 15 && out['自分の情報＋記録で重み付け'] >= 72 && out['自分の情報＋記録で重み付け'] <= 88 ? ' ★' : '';
  console.log(
    `${P}人   ${L}人   ${ownSize}択     ${out['自分の情報だけ'].toFixed(1).padStart(5)}%   ` +
    `${out['他人の話だけ数える'].toFixed(1).padStart(5)}%   ${out['自分の情報＋他人を数える'].toFixed(1).padStart(5)}%    ` +
    `${out['自分の情報＋記録で重み付け'].toFixed(1).padStart(5)}%    +${value.toFixed(1)}pt${ok}`
  );
}
