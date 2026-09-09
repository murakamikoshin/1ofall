/**
 * 崖っぷちモードの形を探す。
 *
 * 通常モードと同じ骨格では成立しない（1人の正直者が7人の嘘に埋もれる）。
 * 別の形にする：**顔ぶれも配役も1周のあいだ変わらない。**
 * 「信じられる1人を見つけ、見つけたら最後まで乗る」という一本道にする。
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `brink-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = C.createRng(31415);
const pick = (a) => a[Math.floor(rng() * a.length)];
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));

/** 一人に賭ける打ち手。崖っぷちの正解手 */
function betOnOne(labels, rows) {
  if (!rows.length) return pick(labels).id;
  const scored = rows.map((r) => ({ r, t: (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2) }));
  const mx = Math.max(...scored.map((x) => x.t));
  const trusted = pick(scored.filter((x) => x.t === mx)).r;
  const t = labels.filter((c) => trusted.text.includes(c.label));
  if (!t.length) return pick(labels).id;
  if (AVOID.test(trusted.text)) return pick(labels.filter((c) => !t.includes(c))).id;
  return pick(t).id;
}

/** 素朴な打ち手＝数えるだけ。崖っぷちでは死ぬはず */
function countOnly(labels, rows) {
  const s = new Map(labels.map((c) => [c.id, 0]));
  for (const r of rows) for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
  const m = Math.max(...s.values());
  return pick([...s].filter(([, v]) => v === m).map(([id]) => id));
}

function run(cfg, policy) {
  const rec = new Map();
  const muted = new Set();
  let lives = cfg.lives, done = 0, attempts = 0;
  let speakerIds = [], honest = null, liarIds = [];

  while (lives > 0 && done < cfg.rooms) {
    // 区切りごとに顔ぶれを入れ替える。狩りをやり直させる
    if (attempts % cfg.block === 0) {
      speakerIds = C.castSpeakers({ advisors: ADV, slots: cfg.slots, mode: 'lottery', rng });
      honest = pick(speakerIds);
      liarIds = speakerIds.filter((id) => id !== honest);
      rec.clear();
      muted.clear();
    }
    const live = speakerIds.filter((id) => !muted.has(id));
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds: live, liarIds }, rng,
      { narrow2: 1, narrow3: 0, doomed: 0 });
    // 崖っぷちでは、唯一の正直者だけが正解を正確に知っている
    if (!muted.has(honest)) kn.set(honest, { kind: 'honest', candidates: [room.correct] });
    const labels = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
    const texts = live.map((id) => C.writeHint({ choices: room.choices, knowledge: kn.get(id), rng,
      liarHonestyRate: cfg.honesty, liarMimicRate: cfg.mimic, voice: C.voiceOf(id) }));
    const rows = live.map((id, i) => ({ id, text: texts[i], rec: rec.get(id) ?? { hit: 0, miss: 0 } }));

    attempts++;
    if (policy(labels, rows) === room.correct) done++; else lives--;

    const cl = labels.find((c) => c.id === room.correct).label;
    live.forEach((id, i) => {
      const x = rec.get(id) ?? { hit: 0, miss: 0 };
      const mc = texts[i].includes(cl);
      const mw = labels.some((c) => c.label !== cl && texts[i].includes(c.label));
      (AVOID.test(texts[i]) ? (!mc && mw) : mc) ? x.hit++ : x.miss++;
      rec.set(id, x);
    });
    // 黙らせる：記録が最悪の相手。正直者を黙らせたら詰む
    if (live.length > 3) {
      let worst = null, wt = 2;
      for (const id of live) {
        const x = rec.get(id) ?? { hit: 0, miss: 0 };
        if (x.hit + x.miss === 0) continue;
        const t = (x.hit + 1) / (x.hit + x.miss + 2);
        if (t < wt) { wt = t; worst = id; }
      }
      if (worst && wt < 0.35 && liarIds.includes(worst)) muted.add(worst);
    }
  }
  return { attempts, deaths: cfg.lives - lives, cleared: done >= cfg.rooms };
}

function measure(cfg) {
  const T = 4000;
  let a = { att: 0, d: 0, win: 0, short: 0 }, b = { att: 0, d: 0, win: 0 };
  for (let i = 0; i < T; i++) {
    const r = run(cfg, betOnOne);
    a.att += r.attempts; a.d += r.deaths; if (r.cleared) a.win++;
    if (r.attempts <= 5) a.short++;
    const q = run(cfg, countOnly);
    b.att += q.attempts; b.d += q.deaths; if (q.cleared) b.win++;
  }
  return {
    skilled: (1 - a.d / a.att) * 100,
    naive: (1 - b.d / b.att) * 100,
    len: a.att / T * 38 / 60,
    clear: a.win / T * 100,
    short: a.short / T * 100,
  };
}

console.log('崖っぷち：正直者はただ一人で、その人だけが正解を正確に知っている。');
console.log('顔ぶれは区切りごとに入れ替わるので、狩りを何度もやり直す\n');
console.log('発言 区切  命 嘘率  一人に賭ける  数えるだけ  腕の差  1周    踏破  短命');
const rooms = 16;
for (const slots of [6, 8]) {
  for (const BLOCK of [3, 4, 5]) {
    for (const HONESTY of [0.25, 0.4]) {
      const lives = 5;
      const cfg = { slots, lives, rooms, honesty: HONESTY, mimic: 0.35, block: BLOCK };
      const r = measure(cfg);
      const ok = r.skilled >= 70 && r.skilled <= 85 && r.skilled - r.naive >= 12
        && r.len >= 6 && r.len <= 13 && r.short < 15 ? ' ★' : '';
      console.log(
        `${slots}人   ${BLOCK}   ${lives} ${HONESTY}  ` +
        `${r.skilled.toFixed(1).padStart(6)}%   ${r.naive.toFixed(1).padStart(6)}%  ` +
        `${(r.skilled - r.naive).toFixed(1).padStart(5)}pt ${r.len.toFixed(1).padStart(5)}分 ` +
        `${r.clear.toFixed(0).padStart(3)}% ${r.short.toFixed(0).padStart(3)}%${ok}`
      );
    }
  }
}
