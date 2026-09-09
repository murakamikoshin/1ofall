/**
 * 新しい仕組みの検証。
 *
 * 問題：全員の助言が見えると、多数決で解けてしまう（生存率100%）。
 * 案  ：助言は伏せて届く。挑戦者は「誰の助言を開くか」をK通だけ選べる。
 *        嘘つきは少数のままでも、開いた3通のうち2通が嘘なら致命傷になる。
 *
 * 測るもの：1部屋あたりの生存率と、1周の長さ（分）。
 */
const rng = Math.random;

function room({ C, S, L, K, skill }) {
  const correct = 0;
  // 嘘つきの位置
  const liars = new Set();
  while (liars.size < L) liars.add(Math.floor(rng() * S));

  // 各発言者が名指しする先（嘘つきは互いに知らないのでばらける）
  const said = [];
  for (let i = 0; i < S; i++) {
    said.push(liars.has(i) ? 1 + Math.floor(rng() * (C - 1)) : correct);
  }

  // 誰を開くか。skill=0 なら完全にランダム、skill=1 なら嘘つきを避けられる
  const order = [...Array(S).keys()].sort(() => rng() - 0.5);
  const opened = [];
  for (const i of order) {
    if (opened.length >= K) break;
    if (liars.has(i) && rng() < skill) continue; // 読みが利いて避けられた
    opened.push(i);
  }
  while (opened.length < K) {                     // 避けきれず埋まらない分
    const i = order.find((x) => !opened.includes(x));
    if (i === undefined) break;
    opened.push(i);
  }

  // 開いた助言だけで判断する。割れたら、その中から選ぶしかない
  const votes = new Array(C).fill(0);
  for (const i of opened) votes[said[i]]++;
  const max = Math.max(...votes);
  const top = votes.reduce((a, v, i) => (v === max ? [...a, i] : a), []);
  return top[Math.floor(rng() * top.length)] === correct;
}

/** 1周を回して、何部屋挑戦できたかを返す */
function run(cfg) {
  let lives = cfg.lives, attempts = 0, cleared = 0, sectionStart = 0;
  while (lives > 0 && cleared < cfg.roomsPerRun) {
    attempts++;
    // 区画が進むほど択が増え、開ける助言が減る
    const section = Math.floor(cleared / cfg.sectionSize);
    const C = Math.min(8, cfg.baseChoices + section);
    const K = Math.max(1, cfg.baseOpen - section);
    if (room({ C, S: cfg.S, L: cfg.L, K, skill: cfg.skill })) {
      cleared++;
      if (cleared % cfg.sectionSize === 0) sectionStart = cleared;
    } else {
      lives--;
      cleared = sectionStart;
    }
  }
  return { attempts, cleared, survived: lives > 0 };
}

function evaluate(label, cfg, secPerRoom, trials = 20000) {
  let att = 0, cle = 0, win = 0;
  for (let i = 0; i < trials; i++) {
    const r = run(cfg);
    att += r.attempts; cle += r.cleared; if (r.survived) win++;
  }
  const a = att / trials;
  const min = (a * secPerRoom) / 60;
  console.log(
    `${label.padEnd(30)} 挑戦${a.toFixed(1).padStart(5)}部屋  到達${(cle/trials).toFixed(1).padStart(5)}  ` +
    `踏破${(win/trials*100).toFixed(0).padStart(3)}%  1周 ${min.toFixed(1).padStart(4)}分`
  );
}

// 1部屋あたりの実時間の見積り：助言が集まるのを待つ 20秒 ＋ 開いて考える 12秒 ＋ 演出 4秒
const SEC = 36;

console.log('■ 1部屋あたりの生存率（開ける助言 K 通・発言者 S 人・嘘つき L 人・C 択）');
for (const [S, L, K, C] of [
  [7, 2, 3, 5], [7, 2, 3, 6], [8, 2, 3, 5], [6, 2, 3, 5],
  [7, 3, 3, 5], [7, 2, 2, 5], [7, 2, 1, 5], [7, 2, 5, 5],
]) {
  let a = 0; const n = 200000;
  for (let i = 0; i < n; i++) if (room({ C, S, L, K, skill: 0 })) a++;
  console.log(`  発言${S}人 嘘つき${L}人 ${K}通開封 ${C}択 → 生存率 ${(a/n*100).toFixed(1)}%`);
}

console.log('\n■ 1周の長さ（1部屋36秒として。読みの腕 skill=0 は完全な運任せ）');
const base = { S: 7, L: 2, lives: 3, sectionSize: 7, roomsPerRun: 21, baseChoices: 5, baseOpen: 4, skill: 0 };
evaluate('現状（全部見える＝多数決）', { ...base, baseOpen: 99, roomsPerRun: 21 }, SEC);
for (const [label, over] of [
  ['命3・区画7・21部屋',        {}],
  ['命3・区画5・20部屋',        { sectionSize: 5, roomsPerRun: 20 }],
  ['命4・区画7・21部屋',        { lives: 4 }],
  ['命3・区画7・28部屋',        { roomsPerRun: 28 }],
  ['命5・区画7・28部屋',        { lives: 5, roomsPerRun: 28 }],
]) evaluate(label, { ...base, ...over }, SEC);

console.log('\n■ 読みが利く場合（常連の顔が分かる友達モード）');
for (const skill of [0, 0.25, 0.5]) {
  evaluate(`読みの腕 ${(skill*100).toFixed(0)}%`, { ...base, skill }, SEC);
}
