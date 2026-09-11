/**
 * 対等になった全員挑戦者モードを測る。
 * 命が人ごとになったので、通常モードの物差しがそのままは使えない。
 *
 * 見るもの
 *   生き残り率     最後まで残った人の割合（低すぎると理不尽、高すぎると緩い）
 *   一周の長さ     何部屋やって終わるか
 *   腕の差         素朴な読みと、設計どおりの読みの差
 *   裏切りの効き   裏切り者がいる区画で、素朴な読みがどれだけ落ちるか
 *   決着の質       同点で運任せになる部屋の割合
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `psim-${process.pid}.mjs`);
await build({
  stdin: { contents: `
    export { PartyEngine } from './src/core/party-engine';
    export { corePackage } from './src/core/pack';
    export { scoreChoices, bestChoice } from './src/core/read-hints';
    export { setLocale, strings, localized } from './src/i18n';
    export { createRng } from './src/core/rng';
    export { PARTY } from './src/core/limits';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const C = await import(pathToFileURL(out).href);
C.setLocale(process.env.LOCALE ?? 'ja');

const RUNS = Number(process.env.RUNS ?? 600);
const SEATS = Number(process.env.SEATS ?? 6);
const rng = C.createRng(Number(process.env.SEED ?? 99));

/** 読み方いろいろ。人間の席にこれを座らせて比べる */
const READERS = {
  '当てずっぽう': ({ choices }) => choices[Math.floor(rng() * choices.length)].id,
  '自分の情報だけ': ({ choices, own }) => {
    if (own?.kind === 'honest' && own.candidates.length) return own.candidates[Math.floor(rng() * own.candidates.length)];
    if (own?.kind === 'trapper') {
      const rest = choices.filter((c) => c.id !== own.trap);
      return (rest[Math.floor(rng() * rest.length)] ?? choices[0]).id;
    }
    return choices[Math.floor(rng() * choices.length)].id;
  },
  '数えるだけ': ({ choices, rows }) => {
    const s = new Map(choices.map((c) => [c.id, 0]));
    for (const r of rows) for (const c of choices) if (r.text.includes(C.localized(c.label))) s.set(c.id, s.get(c.id) + 1);
    return C.bestChoice(s, choices, rng);
  },
  '設計どおり': ({ choices, rows, own }) => C.bestChoice(C.scoreChoices({ choices, rows, own }), choices, rng),
  /*
   * 設計どおりに読みつつ、**記録が崩れている二人に疑いの札を置く**打ち手。
   *
   * 全員挑戦者の札は公開で、二人以上から付いた者が押される
   * （人間が一人の卓では一枚で押せるので、この試算では毎回押せる）。
   * 押された者は扉ひとつを言い切るしかない——嘘つきは罠を押すしかなくなるので
   * 記録が早く固まるが、その人の迷いは読めなくなる。
   * その釣り合いを、同じ物差し（生き残り率）で見る。
   */
  '設計どおり＋札を置く': ({ choices, rows, own, press }) => {
    const worst = [...rows]
      .filter((r) => r.record && r.record.hit + r.record.miss > 0)
      .sort((a, b) => (b.record.miss - b.record.hit) - (a.record.miss - a.record.hit))
      .slice(0, 2)
      .filter((r) => r.record.miss > r.record.hit)
      .map((r) => r.advisorId);
    press?.(worst);
    return C.bestChoice(C.scoreChoices({ choices, rows, own }), choices, rng);
  },
  /*
   * 札を**確信したときだけ**置く打ち手。
   *
   * 押すと相手の迷いが読めなくなる（迷いは絞れている証なので、
   * 全員挑戦者では正直者の一番大事な情報）。毎部屋二人を押すのは
   * 自分の目を潰すのと同じはずなので、二つ以上外している一人に絞る。
   */
  '設計どおり＋札は一枚だけ': ({ choices, rows, own, press }) => {
    const sure = [...rows]
      .filter((r) => r.record && r.record.miss - r.record.hit >= 2)
      .sort((a, b) => (b.record.miss - b.record.hit) - (a.record.miss - a.record.hit))
      .slice(0, 1)
      .map((r) => r.advisorId);
    press?.(sure);
    return C.bestChoice(C.scoreChoices({ choices, rows, own }), choices, rng);
  },
};

function runOnce(reader, seed) {
  const members = Array.from({ length: SEATS }, (_, i) => ({
    id: i === 0 ? 'me' : `ai_${i}`,
    name: i === 0 ? 'あなた' : `仲間${i}`,
    kind: i === 0 ? 'human' : 'ai',
  }));
  const mode = {
    ...C.PARTY,
    lives: Number(process.env.LIVES ?? C.PARTY.lives),
    sections: Number(process.env.SECTIONS ?? C.PARTY.sections),
    roomsPerSection: Number(process.env.PER_SECTION ?? C.PARTY.roomsPerSection),
  };
  const engine = new C.PartyEngine({ pack: C.corePackage(), members, seed, mode });
  let rooms = 0, ties = 0, myDeaths = 0, myRooms = 0;
  /** いま自分が札を置いている相手 */
  let marked = new Set();
  // 裏切り者は罠を知っている＝一つ外せる。それが生き残りに効きすぎていないか
  const traitorRooms = { picks: 0, deaths: 0 };
  const honestRooms = { picks: 0, deaths: 0 };
  engine.start();

  for (let guard = 0; guard < 400; guard++) {
    const state = engine.snapshot();
    if (state.phase === 'gameover' || state.phase === 'cleared') break;
    if (state.phase !== 'choosing' || !state.round) { engine.advancePresentation(); continue; }

    // AI が助言を書く
    for (const h of engine.aiHints()) engine.hint(h.memberId, h.text);
    const round = engine.snapshot().round;
    const choices = round.room.choices;
    const rows = round.advice
      .filter((a) => a.memberId !== 'me')
      .map((a) => ({ advisorId: a.memberId, text: a.text, record: a.record }));

    const alive = engine.snapshot().members.find((m) => m.id === 'me');
    if (alive && !alive.out) {
      const own = engine.knowledgeFor('me');
      // 同点だらけ＝運任せ。質を見るために数えておく
      const s = C.scoreChoices({ choices, rows, own });
      const mx = Math.max(...[...s.values()]);
      if (choices.filter((c) => s.get(c.id) === mx).length > 1) ties++;
      /*
       * 札を置く打ち手のために、置き直す口を渡す。
       * 効くのは次の部屋から（いま並んでいる助言はもう書かれている）。
       */
      const press = (ids) => {
        for (const id of marked) if (!ids.includes(id)) engine.doubt('me', id, false);
        for (const id of ids) if (!marked.has(id)) engine.doubt('me', id, true);
        marked = new Set(ids);
      };
      engine.pick('me', reader({ choices, rows, own, press }));
      myRooms++;
    }
    for (const [id, choice] of engine.aiPicks()) engine.pick(id, choice);
    engine.timeUp();

    const v = engine.snapshot().verdict;
    if (v) {
      rooms++;
      const mine = v.results.find((r) => r.id === 'me');
      if (mine && !mine.survived && mine.chosenId !== null) myDeaths++;
      // その部屋で裏切り者だった者と、そうでない者の生死を分けて数える
      for (const r of v.results) {
        if (r.chosenId === null) continue;
        const k = engine.knowledgeFor(r.id);
        const bucket = k?.kind === 'trapper' || k?.kind === 'liar' ? traitorRooms : honestRooms;
        bucket.picks++;
        if (!r.survived) bucket.deaths++;
      }
    }
    for (let i = 0; i < 3; i++) engine.advancePresentation();
  }

  const final = engine.snapshot();
  const me = final.members.find((m) => m.id === 'me');
  const others = final.members.filter((m) => m.id !== 'me');
  return {
    rooms,
    myRooms,
    ties,
    myDeaths,
    traitorRooms,
    honestRooms,
    survived: me ? !me.out : false,
    livesLeft: me?.lives ?? 0,
    cleared: final.phase === 'cleared',
    othersAlive: others.filter((m) => !m.out).length,
    seats: final.members.length,
  };
}

console.log(`全員挑戦者モード（対等）　${RUNS}周 × ${SEATS}人\n`);
const table = [];
let edge = null;
for (const [name, reader] of Object.entries(READERS)) {
  let rooms = 0, myRooms = 0, ties = 0, deaths = 0, survived = 0, cleared = 0, lives = 0, others = 0;
  const tr = { picks: 0, deaths: 0 }, ho = { picks: 0, deaths: 0 };
  for (let i = 0; i < RUNS; i++) {
    const r = runOnce(reader, 1000 + i);
    rooms += r.rooms; myRooms += r.myRooms; ties += r.ties; deaths += r.myDeaths;
    survived += r.survived ? 1 : 0; cleared += r.cleared ? 1 : 0;
    lives += r.livesLeft; others += r.othersAlive;
    tr.picks += r.traitorRooms.picks; tr.deaths += r.traitorRooms.deaths;
    ho.picks += r.honestRooms.picks; ho.deaths += r.honestRooms.deaths;
  }
  if (name === '設計どおり') {
    const tSurv = 1 - tr.deaths / Math.max(1, tr.picks);
    const hSurv = 1 - ho.deaths / Math.max(1, ho.picks);
    edge = { tSurv, hSurv };
  }
  // 自分が実際に選んだ部屋だけを母数にする（死んだあとの部屋を混ぜない）
  const perRoom = 1 - deaths / Math.max(1, myRooms);
  table.push({ name, perRoom, survived: survived / RUNS, cleared: cleared / RUNS, rooms: myRooms / RUNS, ties: ties / Math.max(1, myRooms), lives: lives / RUNS, others: others / RUNS });
}

const w = (s, n) => String(s).padEnd(n, '　').slice(0, n);
console.log('  読み方          1部屋生存  最後まで  踏破  自分の部屋 残り命 他に残る');
for (const t of table) {
  console.log(`  ${w(t.name, 8)} ${(t.perRoom * 100).toFixed(1).padStart(8)}% ${(t.survived * 100).toFixed(1).padStart(8)}% ${(t.cleared * 100).toFixed(1).padStart(5)}% ${t.rooms.toFixed(1).padStart(7)} ${t.lives.toFixed(2).padStart(7)} ${t.others.toFixed(1).padStart(7)}`);
}
const naive = table.find((t) => t.name === '数えるだけ');
const good = table.find((t) => t.name === '設計どおり');
console.log(`\n  腕の差（1部屋あたり）  ${((good.perRoom - naive.perRoom) * 100).toFixed(1)}pt`);
console.log(`  腕の差（最後まで）     ${((good.survived - naive.survived) * 100).toFixed(1)}pt`);
console.log(`  運任せの部屋           ${(table.find((t) => t.name === '設計どおり').ties * 100).toFixed(1)}%`);
console.log(`  1周の部屋数            ${good.rooms.toFixed(1)}（1部屋40秒として ${(good.rooms * 40 / 60).toFixed(1)}分）`);
if (edge) {
  // 裏切り者は罠を知っている＝一つ外せる。効きすぎると「裏切ったほうが得」になる
  console.log(`\n  裏切り者の生存         ${(edge.tSurv * 100).toFixed(1)}%`);
  console.log(`  そうでない者の生存     ${(edge.hSurv * 100).toFixed(1)}%`);
  console.log(`  裏切りの得             ${((edge.tSurv - edge.hSurv) * 100).toFixed(1)}pt`);
}
