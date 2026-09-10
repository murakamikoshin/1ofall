/**
 * 区画の中で、部屋番号ごとに「どれだけ読めるか」を測る。
 *
 * 一周書き出して読んだら、4部屋目あたりで記録が割れきっていた
 * （正7 嘘0 と 正1 嘘5 が並ぶ）。そこから先は一番上に乗るだけになる。
 * 前半は霧、後半は答え合わせ、という形になっていないかを見る。
 *
 *   node tools/arc-probe.mjs [seeds]
 */
import { build } from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `arc-${process.pid}-${Date.now()}.mjs`);
await build({ stdin: { contents: `export * from './src/core/casting';
  export * from './src/core/hint-writer'; export * from './src/core/limits';
  export * from './src/core/name-calling';
  export * from './src/core/rng'; export { setLocale, strings, localized } from './src/i18n';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const C = await import(pathToFileURL(out).href);
C.setLocale('ja');
const pack = JSON.parse(readFileSync(resolve(root, 'data/rooms.core.json'), 'utf8'));

const SEEDS = Number(process.argv[2] ?? 24);
// SCHEDULE=0 で、裏切りの段取りを外した昔の形（毎部屋のコイン投げ）と比べられる
const SCHEDULE = process.env.SCHEDULE !== '0';
const ADV = Array.from({ length: 12 }, (_, i) => ({ id: `ai_${i}`, name: `名${i}`, kind: 'ai' }));
const nameOf = (id) => ADV.find((a) => a.id === id).name;
const AVOID = C.strings().hints.avoidPattern;
const HEDGE = C.strings().hints.hedgePattern;

/** 本体と同じ読み方（迷いを重く見て、記録で重みを変え、撃たれた者を信じる） */
function read(labels, rows, shots, rng) {
  const called = new Map();
  for (const sh of shots) called.set(sh.to, (called.get(sh.to) ?? 0) + (sh.doubt ? 1 : -0.5));
  const s = new Map(labels.map((c) => [c.id, 0]));
  for (const r of rows) {
    const net = called.get(r.id) ?? 0;
    const w = ((r.rec.hit + 1) / (r.rec.hit + r.rec.miss + 2)) * Math.max(0.2, Math.min(2.6, 1 + net * 0.9));
    const t = labels.filter((c) => r.text.includes(c.label));
    if (!t.length) continue;
    let rest = r.text;
    for (const c of t) rest = rest.split(c.label).join('　');
    if (AVOID.test(rest)) { for (const c of t) s.set(c.id, s.get(c.id) - w * 1.2); continue; }
    const hedging = t.length >= 2 || HEDGE.test(rest);
    for (const c of t) s.set(c.id, s.get(c.id) + w * (hedging ? 1.25 : 0.8));
  }
  const m = Math.max(...s.values());
  const top = [...s].filter(([, v]) => v === m).map(([id]) => id);
  return top[Math.floor(rng() * top.length)];
}

const MODES = {
  通常: { slots: 8, brink: false, m: C.MODES.standard },
  崖っぷち: { slots: 4, brink: true, m: C.MODES.brink },
};

for (const [label, mode] of Object.entries(MODES)) {
  const PER = mode.m.roomsPerSection;
  const byRoom = Array.from({ length: PER }, () => ({ n: 0, hit: 0, naive: 0, gap: 0, gapN: 0 }));

  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = C.createRng(9000 + seed * 613);
    for (let section = 0; section < 4; section++) {
      const speakerIds = C.castSpeakers({ advisors: ADV, slots: mode.slots, mode: 'lottery', rng });
      const liarIds = mode.brink
        ? speakerIds.filter((_, i) => i !== Math.floor(rng() * speakerIds.length))
        : C.castLiars(speakerIds, rng);
      const mix = C.RUN.knowledgeBySection[section];
      const rec = new Map();

      for (let r = 0; r < PER; r++) {
        const room = pack.rooms[Math.floor(rng() * pack.rooms.length)];
        const kn = C.dealKnowledge(room.choices, room.correct, { speakerIds, liarIds }, rng, mix, mode.brink, false);
        const labels = room.choices.map((c) => ({ id: c.id, label: C.localized(c.label) }));
        const said = speakerIds.map((id) => ({
          id, name: nameOf(id),
          text: C.writeHint({
            choices: room.choices, knowledge: kn.get(id), rng,
            liarHonestyRate: Math.max(0.05, Math.min(0.5, mode.m.liarHonesty * C.liarBias(id))),
            liarMimicRate: mode.m.liarMimic, voice: C.voiceOf(id),
            liarHonest: SCHEDULE ? rng() < C.liarHonestyAt(id, r, PER) : undefined,
          }),
        }));
        const shots = [];
        for (const id of speakerIds) {
          if (rng() >= mode.m.nameCall) continue;
          const call = C.chooseCall(kn.get(id), room.choices, said.filter((x) => x.id !== id), rng);
          if (call) shots.push({ from: id, to: call.id, doubt: call.doubt });
        }
        const rows = said.map((x) => ({ ...x, rec: rec.get(x.id) ?? { hit: 0, miss: 0 } }));

        const b = byRoom[r];
        b.n++;
        if (read(labels, rows, shots, rng) === room.correct) b.hit++;
        // 素朴な打ち手（名前を数えるだけ）との差が、その部屋の「読みしろ」
        const tally = new Map(labels.map((c) => [c.id, 0]));
        for (const x of said) for (const c of labels) if (x.text.includes(c.label)) tally.set(c.id, tally.get(c.id) + 1);
        const tm = Math.max(...tally.values());
        const tops = [...tally].filter(([, v]) => v === tm).map(([id]) => id);
        if (tops[Math.floor(rng() * tops.length)] === room.correct) b.naive++;

        // 記録がどれだけ割れているか（嘘つきと協力者の信用の差）
        const tr = (id) => {
          const x = rec.get(id) ?? { hit: 0, miss: 0 };
          return (x.hit + 1) / (x.hit + x.miss + 2);
        };
        const ls = speakerIds.filter((id) => liarIds.includes(id)).map(tr);
        const hs = speakerIds.filter((id) => !liarIds.includes(id)).map(tr);
        if (ls.length && hs.length) {
          const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
          b.gap += mean(hs) - mean(ls);
          b.gapN++;
        }

        const cl = labels.find((c) => c.id === room.correct).label;
        const truth = C.resolveTruth(
          [...said, ...shots.map((sh) => ({
            id: sh.from, name: nameOf(sh.from), kind: 'call',
            text: (sh.doubt ? C.strings().hints.doubt : C.strings().hints.back)[0](nameOf(sh.to)),
          }))],
          (t) => {
            const mc = t.includes(cl);
            const mw = labels.some((c) => c.label !== cl && t.includes(c.label));
            return AVOID.test(t) ? !mc && mw : mc;
          },
          room.choices,
        );
        for (const { id, truthful } of truth) {
          const x = rec.get(id) ?? { hit: 0, miss: 0 };
          truthful ? x.hit++ : x.miss++;
          rec.set(id, x);
        }
      }
    }
  }

  console.log(`\n【${label}】  ${SEEDS}種 × 4区画　裏切りの段取り ${SCHEDULE ? 'あり' : 'なし'}`);
  console.log('  部屋   読める   数えるだけ   読みしろ   記録の割れ');
  for (const [i, b] of byRoom.entries()) {
    const pc = (x) => `${((x / b.n) * 100).toFixed(1)}%`;
    const gap = b.gapN ? (b.gap / b.gapN).toFixed(3) : '—';
    console.log(`   ${i + 1}    ${pc(b.hit).padStart(6)}   ${pc(b.naive).padStart(8)}   ${(((b.hit - b.naive) / b.n) * 100).toFixed(1).padStart(6)}pt   ${gap}`);
  }
}
