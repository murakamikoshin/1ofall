/**
 * 「面白いか」を測る基準。
 *
 * 実際の10人に聞けないので、これまでの検証で「面白くない」と分かった症状を
 * そのまま裏返して基準にした。全部を同時に満たすまで回す。
 *
 *  1. 決断率        一目で決まらない部屋が半分以上あるか
 *  2. 群れの罠率     票が集まった選択肢が外れであることが1割以上あるか
 *  3. 腕の差        素朴な打ち手と、読める打ち手の差が8pt以上あるか
 *  4. 生存率        読める打ち手で 72〜85%
 *  5. 1周の長さ     10〜15分
 *  6. 短命率        1周が5部屋以下で終わる確率が15%未満
 *  7. 攻略の固定化   最良の打ち手が一つに固まっていないか（複数が拮抗するか）
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `rub-${process.pid}-${Date.now()}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/rng'; export { setLocale } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = C.createRng(Number(process.env.SEED ?? 1234));
const pick = (a) => a[Math.floor(rng() * a.length)];
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = /たぶん|気がする|に見える|じゃないか|絞れた|決めきれん|どっちか/;
const AVOID = /やめろ|死ぬ|手を出すな|罠だ|だけは違う|だめだ/;

/** 打ち手いろいろ。最良が一つに固まっていないかも見る */
const PLAYERS = {
  '当てずっぽう': ({ labels }) => pick(labels).id,
  '数えるだけ': ({ labels, rows }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const r of rows) for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
    return top(s);
  },
  '記録で重み付け': ({ labels, rows }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const r of rows) {
      const w = (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2);
      for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + w);
    }
    return top(s);
  },
  '迷いを信じ記録も見る': ({ labels, rows }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const r of rows) {
      const w = (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2);
      const t = labels.filter((c) => r.text.includes(c.label));
      const hedging = t.length >= 2 || HEDGE.test(r.text);
      for (const c of t) s.set(c.id, s.get(c.id) + w * (hedging ? 1.25 : 0.8));
    }
    return top(s);
  },
  '一番信用できる一人に賭ける': ({ labels, rows }) => {
    // 合計すると弱い声が数で勝ってしまう。一人を選んでその人に乗る
    if (!rows.length) return pick(labels).id;
    const scored = rows.map((r) => ({ r, t: (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2) }));
    const mx = Math.max(...scored.map((x) => x.t));
    const trusted = pick(scored.filter((x) => x.t === mx)).r;
    const t = labels.filter((c) => trusted.text.includes(c.label));
    if (!t.length) return pick(labels).id;
    if (AVOID.test(trusted.text)) return pick(labels.filter((c) => !t.includes(c))).id;
    return pick(t).id;
  },
  '票が集まりすぎたものを避ける': ({ labels, rows }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const r of rows) {
      const w = (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2);
      for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + w);
    }
    // 一位が二位を大きく引き離していたら罠を疑い、二位を採る
    const sorted = [...s].sort((a, b) => b[1] - a[1]);
    if (sorted.length >= 2 && sorted[0][1] - sorted[1][1] >= 2.0) return sorted[1][0];
    return top(s);
  },
};
const top = (s) => { const m = Math.max(...s.values()); return pick([...s].filter(([, v]) => v === m).map(([id]) => id)); };

function playSection(slots, mix, mode, players, acc) {
  const speakerIds = C.castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liarIds = mode.brink
    ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
    : C.castLiars(speakerIds, rng);
  const recs = new Map(players.map((p) => [p, new Map()]));
  const alive = new Map(players.map((p) => [p, 0]));

  const PER = mode.rooms ?? C.RUN.roomsPerSection;
  for (let r = 0; r < PER; r++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, !!mode.loneKnows);
    const labels = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
    const texts = speakerIds.map((id) => C.writeHint({
      choices: room.choices, knowledge: kn.get(id), rng,
      liarHonestyRate: mode.honesty(C.liarBias(id)), liarMimicRate: mode.mimic, voice: C.voiceOf(id),
    }));

    // 統計：票の集まり方
    if (acc) {
      const counts = new Map(labels.map((c) => [c.id, 0]));
      texts.forEach((t) => labels.forEach((c) => { if (t.includes(c.label)) counts.set(c.id, counts.get(c.id) + 1); }));
      const sorted = [...counts].sort((a, b) => b[1] - a[1]);
      acc.rooms++;
      if (sorted[0][1] - (sorted[1]?.[1] ?? 0) >= 2) {
        acc.runaway++;
        if (sorted[0][0] !== room.correct) acc.crowdTrap++;
      }
    }

    for (const p of players) {
      const rec = recs.get(p);
      const rows = speakerIds.map((id, i) => ({ id, text: texts[i], rec: rec.get(id) ?? { hit: 0, miss: 0 } }));
      if (PLAYERS[p]({ labels, rows }) === room.correct) alive.set(p, alive.get(p) + 1);
    }
    // 記録は振る舞いで（本体と同じ）
    const cl = labels.find((c) => c.id === room.correct).label;
    for (const p of players) {
      const rec = recs.get(p);
      speakerIds.forEach((id, i) => {
        const x = rec.get(id) ?? { hit: 0, miss: 0 };
        const mc = texts[i].includes(cl);
        const mw = labels.some((c) => c.label !== cl && texts[i].includes(c.label));
        (AVOID.test(texts[i]) ? (!mc && mw) : mc) ? x.hit++ : x.miss++;
        rec.set(id, x);
      });
    }
  }
  return alive;
}

/** 記録が一番悪い相手を選ぶ。挑戦者が毎部屋1人使える「黙らせる」の判断 */
function pickToSilence(ids, rec) {
  let worst = null, worstT = 2;
  for (const id of ids) {
    const x = rec.get(id) ?? { hit: 0, miss: 0 };
    if (x.hit + x.miss === 0) continue;      // 見ていない相手は裁かない
    const t = (x.hit + 1) / (x.hit + x.miss + 2);
    if (t < worstT) { worstT = t; worst = id; }
  }
  return worstT < 0.4 ? worst : null;        // 確信が持てるときだけ使う
}

function fullRun(mode, player) {
  const LIVES = mode.lives ?? C.RUN.lives;
  const SECS = mode.sections ?? C.RUN.sections;
  const PER = mode.rooms ?? C.RUN.roomsPerSection;
  let lives = LIVES, section = 0, attempts = 0;
  while (lives > 0 && section < SECS) {
    const slots = mode.slots ?? C.RUN.slotsBySection[section];
    const mix = C.RUN.knowledgeBySection[section];
    const speakerIds = C.castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
    const liarIds = mode.brink
      ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
      : C.castLiars(speakerIds, rng);
    const rec = new Map();
    const muted = new Set();
    let done = 0;
    while (done < PER && lives > 0) {
      const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
      const live = speakerIds.filter((id) => !muted.has(id));
      const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds: live, liarIds }, rng, mix, !!mode.loneKnows);
      const labels = room.choices.map((c) => ({ id: c.id, label: c.label.ja }));
      const texts = live.map((id) => C.writeHint({
        choices: room.choices, knowledge: kn.get(id), rng,
        liarHonestyRate: mode.honesty(C.liarBias(id)), liarMimicRate: mode.mimic, voice: C.voiceOf(id) }));
      const rows = live.map((id, i) => ({ id, text: texts[i], rec: rec.get(id) ?? { hit: 0, miss: 0 } }));
      attempts++;
      if (PLAYERS[player]({ labels, rows }) === room.correct) done++; else { lives--; done = 0; }
      const cl = labels.find((c) => c.id === room.correct).label;
      live.forEach((id, i) => {
        const x = rec.get(id) ?? { hit: 0, miss: 0 };
        const mc = texts[i].includes(cl);
        const mw = labels.some((c) => c.label !== cl && texts[i].includes(c.label));
        (AVOID.test(texts[i]) ? (!mc && mw) : mc) ? x.hit++ : x.miss++;
        rec.set(id, x);
      });
      // 黙らせる。当たれば以降その人の声は届かない。
      // 全員黙らせると助言が消えるので、3人は残す
      if (live.length > 3) {
        const target = pickToSilence(live, rec);
        if (target && liarIds.includes(target)) muted.add(target);
      }
    }
    if (done >= PER) section++;
  }
  return { attempts, deaths: LIVES - lives, cleared: section >= SECS };
}

export async function evaluate(modeName, mode, quiet) {
  const players = Object.keys(PLAYERS);
  const acc = { rooms: 0, runaway: 0, crowdTrap: 0 };
  const totals = new Map(players.map((p) => [p, 0]));
  let roomsPer = 0;
  const T = 2500;
  const PER = mode.rooms ?? C.RUN.roomsPerSection;
  for (const [i, slots] of (mode.slots ? [mode.slots] : C.RUN.slotsBySection).entries()) {
    const mix = C.RUN.knowledgeBySection[mode.slots ? 0 : i];
    for (let t = 0; t < T; t++) {
      const a = playSection(slots, mix, mode, players, acc);
      for (const p of players) totals.set(p, totals.get(p) + a.get(p));
    }
    roomsPer += T * PER;
  }
  const rate = Object.fromEntries(players.map((p) => [p, totals.get(p) / roomsPer * 100]));
  const bestName = players.slice(1).sort((a, b) => rate[b] - rate[a])[0];
  const best = rate[bestName];
  const secondBest = players.slice(1).sort((a, b) => rate[b] - rate[a])[1];

  // 1周を通して測る。黙らせるを含むので、これが実際の生存率になる
  const lens = [];
  let att = 0, deaths = 0;
  for (let i = 0; i < 3000; i++) {
    const r = fullRun(mode, bestName);
    lens.push(r.attempts); att += r.attempts; deaths += r.deaths;
  }
  lens.sort((a, b) => a - b);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const shortRuns = lens.filter((n) => n <= 5).length / lens.length * 100;
  const liveRate = (1 - deaths / att) * 100;

  const m = {
    決断率: (1 - acc.runaway / acc.rooms) * 100,
    群れの罠率: acc.runaway ? acc.crowdTrap / acc.runaway * 100 : 0,
    腕の差: liveRate - rate['数えるだけ'],
    生存率: liveRate,
    一周分: mean * 38 / 60,
    短命率: shortRuns,
    最良差: best - rate[secondBest],
  };
  const pass = {
    決断率: m.決断率 >= 50, 群れの罠率: m.群れの罠率 >= 10, 腕の差: m.腕の差 >= 8,
    生存率: m.生存率 >= 72 && m.生存率 <= 85, 一周分: m.一周分 >= 10 && m.一周分 <= 15,
    短命率: m.短命率 < 15, 最良差: m.最良差 <= 6,
  };
  if (!quiet) {
    console.log(`\n【${modeName}】  最良の打ち手＝${bestName}`);
    for (const p of players) console.log(`    ${p.padEnd(24)} ${rate[p].toFixed(1)}%`);
    console.log('    ' + '-'.repeat(52));
    const fmt = { 決断率: '%', 群れの罠率: '%', 腕の差: 'pt', 生存率: '%', 一周分: '分', 短命率: '%', 最良差: 'pt' };
    for (const k of Object.keys(m)) {
      console.log(`    ${pass[k] ? '○' : '×'} ${k.padEnd(10)} ${m[k].toFixed(1)}${fmt[k]}`);
    }
    console.log(`    → ${Object.values(pass).filter(Boolean).length} / ${Object.keys(pass).length} 項目`);
  }
  return { m, pass, rate, bestName };
}

if ((process.argv[1] ?? '').endsWith('rubric.mjs')) {
  // 実装されている設定をそのまま測る
  const std = C.MODES.standard;
  const brk = C.MODES.brink;
  await evaluate('通常', {
    honesty: (b) => Math.max(0.05, Math.min(0.5, std.liarHonesty * b)),
    mimic: std.liarMimic,
  });
  await evaluate('崖っぷち', {
    brink: true, loneKnows: true, slots: brk.slotsBySection[0],
    rooms: brk.roomsPerSection, lives: brk.lives, sections: brk.sections,
    honesty: (b) => Math.max(0.05, Math.min(0.5, brk.liarHonesty * b)),
    mimic: brk.liarMimic,
  });
}
