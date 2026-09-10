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
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale(process.env.LOCALE ?? 'ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));
const rng = C.createRng(Number(process.env.SEED ?? 1234));
const pick = (a) => a[Math.floor(rng() * a.length)];
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `a${i}`, kind: 'ai' }));
const HEDGE = C.strings().hints.hedgePattern;
const AVOID = C.strings().hints.avoidPattern;
// 人を指す率。0 にすると助言は全部「扉について」に戻る（A/B用）
const NAMECALL = process.env.NAMECALL === undefined ? null : Number(process.env.NAMECALL);
const rateFor = (mode) => (NAMECALL === null ? mode.nameCall ?? 0 : NAMECALL);
// 名指しを「文面の代わり」ではなく別の道で送る場合の率。
// 扉についての助言は減らないので、情報の総量が落ちない
const POINT = Number(process.env.POINT ?? 0);
const SEENSHOTS = { n: 0 };
// 撃たれた者をどれだけ信じるか。振ってから決める
const BOOST = Number(process.env.BOOST ?? 0.9);
const BOOST_MAX = Number(process.env.BOOST_MAX ?? 2.6);
if (process.env.DEBUG) process.on('exit', () => console.error(`[dbg] 読み手に届いた指し ${SEENSHOTS.n}`));

/** 一部屋ぶん、先に喋った者を積みながら書く */
function writeRound(ids, room, kn, mode) {
  const said = [];
  const texts = [];
  for (const id of ids) {
    const text = C.writeHint({
      choices: room.choices, knowledge: kn.get(id), rng,
      liarHonestyRate: mode.honesty(C.liarBias(id)), liarMimicRate: mode.mimic, voice: C.voiceOf(id),
      said: [...said], nameCallRate: rateFor(mode),
    });
    said.push({ id, name: nameOf(id), text });
    texts.push(text);
  }
  // 別の道で指す。文面はそのまま扉の話なので、指しても情報は減らない
  const shots = [];
  if (POINT > 0) {
    for (const id of ids) {
      if (rng() >= POINT) continue;
      const call = C.chooseCall(kn.get(id), room.choices, said.filter((s) => s.id !== id), rng);
      if (call) shots.push({ from: id, to: call.id, doubt: call.doubt });
    }
  }
  texts.shots = shots;
  return texts;
}
const nameOf = (id) => ADV.find((a) => a.id === id)?.name ?? '';

/** 記録付け。人を指した助言は指した相手の正誤で決まる（本体と同じ） */
function bumpRecords(ids, texts, room, labels, rec) {
  const cl = labels.find((c) => c.id === room.correct).label;
  const doorTruth = (t) => {
    const mc = t.includes(cl);
    const mw = labels.some((c) => c.label !== cl && t.includes(c.label));
    return AVOID.test(t) ? !mc && mw : mc;
  };
  const truth = C.resolveTruth(
    ids.map((id, i) => ({ id, name: nameOf(id), text: texts[i] })),
    doorTruth,
    room.choices,
  );
  for (const { id, truthful: ok } of truth) {
    const x = rec.get(id) ?? { hit: 0, miss: 0 };
    ok ? x.hit++ : x.miss++;
    rec.set(id, x);
  }
}

/** 打ち手いろいろ。最良が一つに固まっていないかも見る */
const PLAYERS = {
  '当てずっぽう': ({ labels }) => pick(labels).id,
  '自分の情報だけ': ({ labels, own }) => (own?.length ? pick(own) : pick(labels).id),
  '数えるだけ': ({ labels, rows }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const r of rows) for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + 1);
    return top(s);
  },
  '記録で重み付け': ({ labels, rows, own }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const id of own ?? []) s.set(id, (s.get(id) ?? 0) + 2.5);
    for (const r of rows) {
      const w = (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2);
      for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + w);
    }
    return top(s);
  },
  '迷いを信じ記録も見る': ({ labels, rows, own }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const id of own ?? []) s.set(id, (s.get(id) ?? 0) + 2.5);
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
  // 本体（src/core/read-hints.ts）と同じ読み方。名指しの扱いだけを差し替えて比べる
  '本体の読み方': (a) => coreRead(a, 'none'),
  // 一番強い打ち手（記録で重み付け）に、撃たれた数だけを足す。
  // これが上がらないなら、名指しは読む価値が無いということ
  /**
   * 区画を通して「ずっと撃たれている人」を見る。
   *
   * 一部屋ぶんの撃たれ方だけを見ると弱い（一度撃たれた者が正解を言っている率は
   * 通常で 49%）。顔ぶれは区画のあいだ変わらないので、**積める。**
   * 人間はこちらを自然にやる（「あいつ、さっきから撃たれてるな」）ので、
   * 一部屋ぶんしか見ない打ち手で測っていると深さを取りこぼす。
   */
  '撃たれ続けている者を信じる': ({ labels, rows, own, shotHistory }) => {
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const id of own ?? []) s.set(id, (s.get(id) ?? 0) + 2.5);
    for (const r of rows) {
      const h = shotHistory?.get(r.id) ?? { shot: 0, rooms: 0 };
      // 撃たれた部屋の割合。半分以上撃たれているなら重く見る
      const rate = h.rooms ? h.shot / h.rooms : 0;
      const w = ((r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2)) * (1 + rate * 1.6);
      const t = labels.filter((c) => r.text.includes(c.label));
      if (!t.length) continue;
      let rest = r.text;
      for (const c of t) rest = rest.split(c.label).join('　');
      if (AVOID.test(rest)) { for (const c of t) s.set(c.id, s.get(c.id) - w * 1.2); continue; }
      const hedging = t.length >= 2 || HEDGE.test(rest);
      for (const c of t) s.set(c.id, s.get(c.id) + w * (hedging ? 1.25 : 0.8));
    }
    return top(s);
  },
  '記録＋撃たれた者を疑う': (a) => shotRead(a, -1),
  '記録＋撃たれた者を信じる': (a) => shotRead(a, 1),
};

/** 記録で重み付けしたうえで、撃たれた者の声を sign の向きに動かす */
function shotRead({ labels, rows, own, shots }, sign) {
  {
    const called = new Map();
    for (const sh of shots ?? []) called.set(sh.to, (called.get(sh.to) ?? 0) + (sh.doubt ? sign : -sign * 0.5));
    const s = new Map(labels.map((c) => [c.id, 0]));
    for (const id of own ?? []) s.set(id, (s.get(id) ?? 0) + 2.5);
    for (const r of rows) {
      const net = called.get(r.id) ?? 0;
      const w = ((r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2)) * Math.max(0.2, Math.min(BOOST_MAX, 1 + net * BOOST));
      for (const c of labels) if (r.text.includes(c.label)) s.set(c.id, s.get(c.id) + w);
    }
    return top(s);
  }
}

const REST = {
  '撃たれた者を疑う': (a) => coreRead(a, 'down'),
  '撃たれた者を信じる': (a) => coreRead(a, 'up'),
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
/**
 * 本体と同じ読み方。calls で名指しの扱いを変える。
 *   none   … 名指しを読まない
 *   flat   … 疑われた者の声を（疑った側の信用のぶん）小さくする
 *   signed … 疑った側の信用で符号を変える。
 *            信用の無い者に疑われたなら、その相手はむしろ本当のことを言っている
 */
function coreRead({ labels, rows, own, shots }, calls) {
  const people = rows.map((r) => ({ id: r.id, name: nameOf(r.id) }));
  const trust = (r) => (r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2);
  const called = new Map();
  if (calls !== 'none') for (const sh of shots ?? []) {
    SEENSHOTS.n++;
    const v = calls === 'down' ? (sh.doubt ? -1 : 0.5) : (sh.doubt ? 1 : -0.5);
    called.set(sh.to, (called.get(sh.to) ?? 0) + v);
  }
  if (calls !== 'none') {
    for (const r of rows) {
      if (labels.some((c) => r.text.includes(c.label))) continue;
      const call = C.readCall(r.text, people);
      if (!call || call.targetId === r.id) continue;
      const t = trust(r);
      // 実測：撃たれた者ほど正解を口にしている（崖っぷちで二度撃たれた者は 97.7%）。
      // 嘘つきは全員が同じ正解を知っているので、真実を言った者に群がる
      const push =
        calls === 'down' ? (call.doubt ? -t : t)
        : calls === 'upTrust' ? (call.doubt ? 1 - t : -(1 - t)) * 1.0
        : (call.doubt ? 1 : -0.5);
      called.set(call.targetId, (called.get(call.targetId) ?? 0) + push);
    }
  }
  const s = new Map(labels.map((c) => [c.id, 0]));
  for (const id of own ?? []) s.set(id, (s.get(id) ?? 0) + 2.5);
  for (const r of rows) {
    const net = called.get(r.id) ?? 0;
    const w = trust(r) * Math.max(0.2, Math.min(BOOST_MAX, 1 + net * BOOST));
    const t = labels.filter((c) => r.text.includes(c.label));
    if (!t.length) continue;
    let rest = r.text;
    for (const c of t) rest = rest.split(c.label).join('　');
    if (AVOID.test(rest)) { for (const c of t) s.set(c.id, s.get(c.id) - w * 1.2); continue; }
    const hedging = t.length >= 2 || HEDGE.test(rest);
    for (const c of t) s.set(c.id, s.get(c.id) + w * (hedging ? 1.25 : 0.8));
  }
  return top(s);
}

Object.assign(PLAYERS, REST);

const top = (s) => { const m = Math.max(...s.values()); return pick([...s].filter(([, v]) => v === m).map(([id]) => id)); };

function playSection(slots, mix, mode, players, acc) {
  const speakerIds = C.castSpeakers({ advisors: ADV, slots, mode: 'lottery', rng });
  const liarIds = mode.brink
    ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
    : C.castLiars(speakerIds, rng);
  const recs = new Map(players.map((p) => [p, new Map()]));
  const alive = new Map(players.map((p) => [p, 0]));
  // 区画を通した撃たれ方。顔ぶれは変わらないので積める
  const shotHist = new Map();

  const PER = mode.rooms ?? C.RUN.roomsPerSection;
  for (let r = 0; r < PER; r++) {
    const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
    const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, !!mode.loneKnows, !!mode.trapper);
    const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
    const texts = writeRound(speakerIds, room, kn, mode);

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

    const own = mode.ownCandidates
      ? C.dealOwnKnowledge(room.choices, room.correct, mode.ownCandidates, rng)
      : [];
    for (const p of players) {
      const rec = recs.get(p);
      const rows = speakerIds.map((id, i) => ({ id, text: texts[i], rec: rec.get(id) ?? { hit: 0, miss: 0 } }));
      if (PLAYERS[p]({ labels, rows, own, choices: room.choices, shots: texts.shots, shotHistory: shotHist }) === room.correct) alive.set(p, alive.get(p) + 1);
    }
    // 記録は振る舞いで（本体と同じ）
    for (const p of players) bumpRecords(speakerIds, texts, room, labels, recs.get(p));
    for (const id of speakerIds) {
      const h = shotHist.get(id) ?? { shot: 0, rooms: 0 };
      h.rooms++;
      if ((texts.shots ?? []).some((x) => x.to === id && x.doubt)) h.shot++;
      shotHist.set(id, h);
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
    const shotHist = new Map();
    const muted = new Set();
    let done = 0;
    while (done < PER && lives > 0) {
      const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
      const live = speakerIds.filter((id) => !muted.has(id));
      const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds: live, liarIds }, rng, mix, !!mode.loneKnows, !!mode.trapper);
      const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
      const texts = writeRound(live, room, kn, mode);
      const rows = live.map((id, i) => ({ id, text: texts[i], rec: rec.get(id) ?? { hit: 0, miss: 0 } }));
      const own = mode.ownCandidates
        ? C.dealOwnKnowledge(room.choices, room.correct, mode.ownCandidates, rng)
        : [];
      attempts++;
      if (PLAYERS[player]({ labels, rows, own, choices: room.choices, shots: texts.shots, shotHistory: shotHist }) === room.correct) done++; else { lives--; done = 0; }
      bumpRecords(live, texts, room, labels, rec);
      for (const id of live) {
        const h = shotHist.get(id) ?? { shot: 0, rooms: 0 };
        h.rooms++;
        if ((texts.shots ?? []).some((x) => x.to === id && x.doubt)) h.shot++;
        shotHist.set(id, h);
      }
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
  // 実装されている設定をそのまま測る。
  // 全員挑戦者モードは命が人ごとで構造が違うので、この物差しでは測れない。
  // あちらは tools/party-sim.mjs で見る
  const std = C.MODES.standard;
  const brk = C.MODES.brink;
  await evaluate('通常', {
    honesty: (b) => Math.max(0.05, Math.min(0.5, std.liarHonesty * b)),
    mimic: std.liarMimic, nameCall: std.nameCall,
  });
  await evaluate('崖っぷち', {
    brink: true, loneKnows: true, slots: brk.slotsBySection[0],
    rooms: brk.roomsPerSection, lives: brk.lives, sections: brk.sections,
    honesty: (b) => Math.max(0.05, Math.min(0.5, brk.liarHonesty * b)),
    mimic: brk.liarMimic, nameCall: brk.nameCall,
  });
}
