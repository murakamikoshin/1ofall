/**
 * 新設計の検証。
 *
 * 前提の変更：
 *   - 助言は伏せない（全部見える）。めくる順で決まる運ゲーを消す
 *   - 嘘つきだけが正解を知る。協力者は「これは違う」を数個知るだけ
 *     → 協力者は正解を名指しできないので、多数決が成立しない
 *     → 「これが正解だ」と断言できるのは嘘つきだけ＝断言が手掛かりになる
 */
const rng = Math.random;

/**
 * @param N 選択肢の数
 * @param M 発言者
 * @param L 嘘つき
 * @param K 協力者ひとりが知っている「違う」選択肢の数
 * @param liarStyle 嘘つきの打ち方
 * @param policy 挑戦者の打ち方
 */
function room(N, M, L, K, liarStyle, policy) {
  const correct = 0;
  const wrong = Array.from({ length: N - 1 }, (_, i) => i + 1);

  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * M));

  // claims[choice] = { deny: n, push: n }
  const claims = Array.from({ length: N }, () => ({ deny: 0, push: 0 }));

  for (let i = 0; i < M; i++) {
    if (liars.has(i)) {
      if (liarStyle === 'denyCorrect') claims[correct].deny++;
      else if (liarStyle === 'pushWrong') claims[wrong[Math.floor(rng() * wrong.length)]].push++;
      else {
        // 半々で混ぜる。断言は目立つので毎回は使わない
        if (rng() < 0.5) claims[correct].deny++;
        else claims[wrong[Math.floor(rng() * wrong.length)]].push++;
      }
    } else {
      // 協力者は「違う」ものを K 個知っていて、そのうち1つを言う
      const known = [];
      const pool = wrong.slice();
      for (let k = 0; k < K && pool.length; k++) known.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      claims[known[Math.floor(rng() * known.length)]].deny++;
    }
  }

  const pick = policy(claims, N);
  return pick === correct;
}

const POLICY = {
  // 否定が一番少ないものを選ぶ（素朴）
  fewestDenied: (claims, N) => {
    const min = Math.min(...claims.map((c) => c.deny));
    const top = [...Array(N).keys()].filter((i) => claims[i].deny === min);
    return top[Math.floor(rng() * top.length)];
  },
  // 2人以上に否定されたものは確実に外れとみなし、残りから選ぶ
  trustMultiple: (claims, N) => {
    const safe = [...Array(N).keys()].filter((i) => claims[i].deny < 2);
    const pool = safe.length ? safe : [...Array(N).keys()];
    return pool[Math.floor(rng() * pool.length)];
  },
  // 上に加えて「押されているもの」を疑う（断言できるのは嘘つきだけ）
  suspectPush: (claims, N) => {
    const safe = [...Array(N).keys()].filter((i) => claims[i].deny < 2 && claims[i].push === 0);
    const pool = safe.length ? safe : [...Array(N).keys()].filter((i) => claims[i].deny < 2);
    const p2 = pool.length ? pool : [...Array(N).keys()];
    return p2[Math.floor(rng() * p2.length)];
  },
  random: (_c, N) => Math.floor(rng() * N),
};

function rate(N, M, L, K, style, policyName, n = 60000) {
  let a = 0;
  for (let i = 0; i < n; i++) if (room(N, M, L, K, style, POLICY[policyName])) a++;
  return a / n * 100;
}

console.log('嘘つきの打ち方＝正解を「違う」と潰す / 外れを押す / 半々\n');
console.log('択 発言 嘘 知識  素朴   2人以上否定を信用  断言を疑う   当てずっぽう');
for (const [N, M, L, K] of [
  [5, 6, 1, 2], [5, 6, 2, 2], [6, 6, 1, 2], [6, 6, 2, 2],
  [6, 8, 2, 2], [6, 8, 2, 3], [7, 8, 2, 2], [7, 8, 2, 3],
  [6, 5, 1, 2], [6, 4, 1, 2],
]) {
  const r = (p) => rate(N, M, L, K, 'mixed', p).toFixed(1).padStart(5);
  console.log(`${N}択 ${String(M).padStart(2)}人 ${L}人 ${K}個  ${r('fewestDenied')}%  ${r('trustMultiple')}%          ${r('suspectPush')}%       ${r('random')}%`);
}
