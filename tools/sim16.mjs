/**
 * いちばん痛い検証：この読み合いは表計算で解けるのか。
 *
 * 解けるなら「人を読む」は幻で、最適な重み付けを一度見つけたら
 * あとは作業になる。天井（生成過程を全部知っている打ち手）と
 * 素朴な打ち手の差を測って、腕の伸びしろがどれだけあるかを見る。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `core16-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * from './src/core/casting';
                      export * from './src/core/hint-writer';
                      export * from './src/core/limits';
                      export * from './src/core/rng';
                      export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { castSpeakers, castLiars, dealKnowledge, writeHint, voiceOf, liarBias, createRng, RUN, setLocale } =
  await import(pathToFileURL(out).href);
setLocale('ja');

const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = createRng(777);
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

function makeRoom(slots, mix) {
  const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
  const speakerIds = castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liarIds = castLiars(speakerIds, rng);
  const knowledge = dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix);
  const hints = speakerIds.map((id) => ({
    id,
    text: writeHint({
      choices: room.choices, knowledge: knowledge.get(id), rng,
      liarHonestyRate: 0.55 - Math.min(0.4, liarBias(id) * 0.16), voice: voiceOf(id),
    }),
  }));
  return { room, hints, liarIds, speakerIds };
}

const labelsOf = (room) => room.choices.map((c) => ({ id: c.id, label: c.label.ja }));

/** 素朴：名前が挙がった回数を数えるだけ */
function countOnly({ room, hints }) {
  const L = labelsOf(room);
  const s = new Map(L.map((c) => [c.id, 0]));
  for (const h of hints) for (const c of L) if (h.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
  return best(s, L);
}

/** 重み付け：断言を疑い、迷いを信じ、否定を引く */
function weighted({ room, hints }) {
  const L = labelsOf(room);
  const s = new Map(L.map((c) => [c.id, 0]));
  for (const h of hints) {
    const t = L.filter((c) => h.text.includes(c.label));
    if (AVOID.test(h.text)) { for (const c of t) s.set(c.id, s.get(c.id) - 0.9); continue; }
    const hedging = t.length >= 2 || HEDGE.test(h.text);
    for (const c of t) s.set(c.id, s.get(c.id) + (hedging ? 1.0 : 0.45));
  }
  return best(s, L);
}

/**
 * 天井：一人ひとりの嘘つき癖と話し方の癖まで知っていて、
 * その人がその文面を書く確率を全選択肢について計算する打ち手。
 * 人間には到達できない。ここが理論上の上限。
 */
function bayes({ room, hints }) {
  const L = labelsOf(room);
  const post = new Map(L.map((c) => [c.id, 0]));
  const SAMPLES = 240;

  for (const cand of L) {
    let logp = 0;
    for (const h of hints) {
      // その人が「正解＝cand」の世界でこの文面を書く確からしさを、
      // 実際の生成器を何度も回して数える
      let hit = 0;
      const fake = { ...room, correct: cand.id, choices: room.choices };
      for (let s = 0; s < SAMPLES / hints.length + 4; s++) {
        const isLiar = rng() < 0.25;
        const kn = isLiar
          ? { kind: 'liar', correct: cand.id }
          : dealKnowledge(room.choices, cand.id, { speakerIds: [h.id], liarIds: [] }, rng,
              RUN.knowledgeBySection[0]).get(h.id);
        const t = writeHint({
          choices: fake.choices, knowledge: kn, rng,
          liarHonestyRate: 0.55 - Math.min(0.4, liarBias(h.id) * 0.16), voice: voiceOf(h.id),
        });
        if (t === h.text) hit++;
      }
      logp += Math.log((hit + 0.5) / (SAMPLES / hints.length + 5));
    }
    post.set(cand.id, logp);
  }
  return best(post, L);
}

function best(map, L) {
  const max = Math.max(...map.values());
  const top = [...map].filter(([, v]) => v === max).map(([id]) => id);
  return top[Math.floor(rng() * top.length)];
}

function rate(policy, slots, mix, n) {
  let a = 0;
  for (let i = 0; i < n; i++) {
    const r = makeRoom(slots, mix);
    if (policy(r) === r.room.correct) a++;
  }
  return a / n * 100;
}

console.log('腕の伸びしろ（区画1の条件：発言8人・目利き80%）\n');
const mix = RUN.knowledgeBySection[0];
console.log(`当てずっぽう                 ${(100 / 5.6).toFixed(1)}%（6択と5択が混在）`);
console.log(`名前が挙がった回数を数えるだけ   ${rate(countOnly, 8, mix, 20000).toFixed(1)}%`);
console.log(`断言を疑い迷いを信じる         ${rate(weighted, 8, mix, 20000).toFixed(1)}%`);
console.log(`天井（生成過程を全部知る）      ${rate(bayes, 8, mix, 700).toFixed(1)}%`);
